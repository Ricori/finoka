package selfupdate

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// The Wails updater only installs through Restart, which relaunches the
// application once the swap is done — the wrong shape for a build installed
// while the user is quitting. This is the same helper protocol (re-exec self
// with sentinel environment variables, wait for the parent to exit, replace
// the binary on disk) minus the relaunch, so the staged build is simply what
// starts the next time the user opens the app.
const (
	installerEnvironment       = "NONOKA_UPDATE_INSTALLER"
	installerTargetEnvironment = "NONOKA_UPDATE_INSTALLER_TARGET"
	installerSourceEnvironment = "NONOKA_UPDATE_INSTALLER_SOURCE"
	installerPIDEnvironment    = "NONOKA_UPDATE_INSTALLER_PID"
)

const (
	// The parent stops the sidecar before it exits, so the helper has to
	// outwait a shutdown that is allowed to take its time.
	parentExitTimeout = 2 * time.Minute
	swapAttempts      = 20
	swapRetryInterval = 500 * time.Millisecond
)

// HandleInstaller performs the deferred swap when this process was spawned as
// an install helper, and never returns in that case. main calls it before
// anything else so a helper never opens a window or touches the data
// directory.
func HandleInstaller() {
	if os.Getenv(installerEnvironment) != "1" {
		return
	}
	pid, _ := strconv.Atoi(os.Getenv(installerPIDEnvironment))
	os.Exit(runInstaller(os.Getenv(installerTargetEnvironment), os.Getenv(installerSourceEnvironment), pid, waitForExit))
}

// spawnInstaller hands the staged build to a detached copy of ourselves. The
// helper blocks until this process is gone, so the caller only has to start it
// and carry on shutting down.
func spawnInstaller(staged string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	command := exec.Command(executable)
	command.Stdin, command.Stdout, command.Stderr = nil, nil, nil
	command.Env = append(os.Environ(),
		installerEnvironment+"=1",
		installerTargetEnvironment+"="+installTarget(executable),
		installerSourceEnvironment+"="+staged,
		installerPIDEnvironment+"="+strconv.Itoa(os.Getpid()),
	)
	detachCommand(command)
	return command.Start()
}

// runInstaller is the helper body, with the wait injected so tests can drive
// every branch without spawning processes. The return is the helper's exit
// code; each failure gets its own so the log line identifies the step.
func runInstaller(target, source string, parentPID int, wait func(int, time.Duration) error) int {
	log := openInstallerLog()
	defer log.Close()
	log.printf("installer start: target=%s source=%s pid=%d", target, source, parentPID)

	if target == "" || source == "" {
		log.printf("missing target or source")
		return 2
	}
	if _, err := os.Stat(target); err != nil {
		log.printf("stat target: %v", err)
		return 3
	}
	if _, err := os.Stat(source); err != nil {
		log.printf("stat source: %v", err)
		return 4
	}
	// Swapping while the application still holds its own image open fails on
	// Windows, and everywhere else it would race a running instance, so a
	// parent that never exits leaves the update for the next session.
	if parentPID > 0 {
		if err := wait(parentPID, parentExitTimeout); err != nil {
			log.printf("parent did not exit: %v", err)
			return 5
		}
	}
	// Staged once, outside the retry loop: it consumes the download, so an
	// attempt that fails after it would have nothing left to retry with.
	staged, err := stageBeside(target, source)
	if err != nil {
		log.printf("stage beside target: %v", err)
		return 6
	}
	var swapErr error
	for attempt := 0; attempt < swapAttempts; attempt++ {
		if swapErr = replaceExecutable(target, staged); swapErr == nil {
			discardStaging(source)
			log.printf("installed on attempt %d", attempt+1)
			return 0
		}
		time.Sleep(swapRetryInterval)
	}
	// Every attempt left the running build in place, so the staged copy is the
	// only thing to take back out of the install directory.
	_ = os.RemoveAll(staged)
	log.printf("swap failed: %v", swapErr)
	return 7
}

// replaceExecutable swaps the already-staged sibling into target's slot with
// two renames on one volume, so the window in which no file sits at target —
// what a user relaunching the app right after quitting would fall into — is as
// short as the filesystem can make it. Renaming the old build aside rather
// than deleting it is what makes this work on Windows, where the kernel holds
// the image of a recently running executable open: a rename it allows, a
// delete it does not. An aside that cannot be removed here is swept by
// CleanupReplacedExecutables on the next launch.
//
// Every failure leaves the running build at target and the staged build where
// it was, so the caller can simply try again.
func replaceExecutable(target, staged string) error {
	mode := os.FileMode(0)
	if info, err := os.Stat(target); err == nil && info.Mode().IsRegular() {
		mode = info.Mode().Perm()
	}
	aside := fmt.Sprintf("%s.old.%d", target, time.Now().UnixNano())
	if err := os.Rename(target, aside); err != nil {
		return fmt.Errorf("rename aside: %w", err)
	}
	if err := os.Rename(staged, target); err != nil {
		_ = os.Rename(aside, target)
		return fmt.Errorf("rename into place: %w", err)
	}
	// The artifact was downloaded as a plain file, which on Unix costs it the
	// executable bit the build it replaces was running with.
	if mode != 0 && runtime.GOOS != "windows" {
		_ = os.Chmod(target, mode)
	}
	_ = os.RemoveAll(aside)
	return nil
}

// stageBeside puts the new build in the target's own directory and returns its
// path. Renaming it out of the staging directory is enough when that directory
// shares a volume with the install; when it does not — the downloader stages
// under the system temp directory, routinely a different drive — the bytes are
// copied here while the running build is still in place, rather than during
// the window where it is not.
func stageBeside(target, source string) (string, error) {
	beside := fmt.Sprintf("%s.new.%d", target, time.Now().UnixNano())
	if err := os.Rename(source, beside); err == nil {
		return beside, nil
	}
	if err := copyPath(source, beside); err != nil {
		_ = os.RemoveAll(beside)
		return "", fmt.Errorf("stage %s: %w", source, err)
	}
	return beside, nil
}

// copyPath duplicates a file, a symlink or a directory tree. macOS ships the
// application as a .app bundle, which is a directory.
func copyPath(source, destination string) error {
	info, err := os.Lstat(source)
	switch {
	case err != nil:
		return err
	case info.Mode()&os.ModeSymlink != 0:
		link, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(link, destination)
	case info.IsDir():
		if err := os.MkdirAll(destination, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyPath(filepath.Join(source, entry.Name()), filepath.Join(destination, entry.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	return copyFile(source, destination, info.Mode().Perm())
}

func copyFile(source, destination string, mode os.FileMode) error {
	reader, err := os.Open(source)
	if err != nil {
		return err
	}
	defer reader.Close()
	writer, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(writer, reader); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Sync(); err != nil {
		_ = writer.Close()
		return err
	}
	return writer.Close()
}

// discardStaging removes the temp directory the Wails downloader staged into.
// Guarded by the prefix so an unexpected source path is never torn down
// recursively along with whatever else shares its directory.
func discardStaging(source string) {
	directory := filepath.Dir(source)
	if strings.HasPrefix(filepath.Base(directory), "wails-update-") {
		_ = os.RemoveAll(directory)
	}
}

// installTarget is the path the swap replaces: the executable itself, except
// on macOS where the .app bundle around it is what ships.
func installTarget(executable string) string {
	if runtime.GOOS != "darwin" {
		return executable
	}
	parts := strings.Split(filepath.Clean(executable), string(os.PathSeparator))
	for index, part := range parts {
		if strings.HasSuffix(part, ".app") {
			return string(os.PathSeparator) + filepath.Join(parts[1:index+1]...)
		}
	}
	return executable
}

// waitForExit polls until the process is gone. Portable, and the helper has
// nothing else to do while it waits.
func waitForExit(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("process %d still running after %s", pid, timeout)
}

// installerLog is the helper's only channel: it runs detached, with no stdio
// and no window, so a failed swap is otherwise invisible.
type installerLog struct{ file *os.File }

func openInstallerLog() *installerLog {
	file, err := os.Create(filepath.Join(os.TempDir(), "nonoka-update-install.log"))
	if err != nil {
		return &installerLog{}
	}
	return &installerLog{file: file}
}

func (l *installerLog) printf(format string, arguments ...any) {
	if l == nil || l.file == nil {
		return
	}
	fmt.Fprintf(l.file, "%s: %s\n", time.Now().Format(time.RFC3339), fmt.Sprintf(format, arguments...))
}

func (l *installerLog) Close() {
	if l != nil && l.file != nil {
		_ = l.file.Close()
	}
}
