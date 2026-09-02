package selfupdate

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// CleanupReplacedExecutables removes the "<name>.exe.old.<timestamp>" copies the
// Windows update helper leaves behind, along with any "<name>.exe.new.<timestamp>"
// left by a swap that was interrupted before it renamed the file into place. The
// old image is still mapped while the helper exits, so the new build retries for
// a short window after launch.
func CleanupReplacedExecutables() {
	if runtime.GOOS != "windows" {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		return
	}
	go func() {
		for attempt := 0; attempt < 60; attempt++ {
			if removeReplacedExecutables(executable) == 0 {
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()
}

func removeReplacedExecutables(executable string) int {
	directory, name := filepath.Dir(executable), filepath.Base(executable)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return 0
	}
	remaining := 0
	for _, entry := range entries {
		if entry.IsDir() || !replacedExecutable(entry.Name(), name) {
			continue
		}
		if err := os.Remove(filepath.Join(directory, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			remaining++
		}
	}
	return remaining
}

// replacedExecutable reports whether entry is one of the timestamped copies the
// swap makes of name, rather than an unrelated neighbour that happens to share
// the prefix.
func replacedExecutable(entry, name string) bool {
	for _, prefix := range []string{name + ".old.", name + ".new."} {
		if !strings.HasPrefix(entry, prefix) {
			continue
		}
		if _, err := strconv.ParseInt(strings.TrimPrefix(entry, prefix), 10, 64); err == nil {
			return true
		}
	}
	return false
}
