package storage

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// heldTree builds a directory with one file kept open, which is the state a
// virus scanner leaves a freshly written runtime in: Windows then refuses to
// rename or remove the directory around it.
func heldTree(t *testing.T) (directory string, release func()) {
	t.Helper()
	directory = filepath.Join(t.TempDir(), "finesub")
	if err := os.MkdirAll(filepath.Join(directory, "runtime"), 0o755); err != nil {
		t.Fatal(err)
	}
	handle, err := os.OpenFile(filepath.Join(directory, "runtime", "python.exe"), os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	return directory, func() {
		if !closed {
			closed = true
			_ = handle.Close()
		}
	}
}

// The failure this guards against reached a user as
// "rename ...finesub.finoka-incoming ...finesub: Access is denied." after a
// 14 GB copy. Classifying it as permanent is what threw that copy away.
func TestOpenHandleMakesADirectoryRenameRetryable(t *testing.T) {
	directory, release := heldTree(t)
	defer release()

	err := os.Rename(directory, directory+"-moved")
	if err == nil {
		t.Skip("this Windows build allows renaming a directory with an open handle inside")
	}
	if !retryableFileError(err) {
		t.Fatalf("a scanner-style sharing failure was classified as permanent: %v", err)
	}
	if removeErr := os.RemoveAll(directory); removeErr == nil {
		t.Skip("this Windows build allows removing a directory with an open handle inside")
	} else if !retryableFileError(removeErr) {
		t.Fatalf("a held file made removal look permanent: %v", removeErr)
	}
}

func TestTryRenameWaitsOutAHeldHandle(t *testing.T) {
	directory, release := heldTree(t)
	defer release()
	if err := os.Rename(directory, directory+"-probe"); err == nil {
		_ = os.Rename(directory+"-probe", directory)
		t.Skip("this Windows build allows renaming a directory with an open handle inside")
	}

	// The handle goes away while tryRename is between attempts, which is how a
	// scanner behaves: it finishes with the file and lets go.
	time.AfterFunc(400*time.Millisecond, release)
	destination := filepath.Join(filepath.Dir(directory), "finesub-moved")
	if !tryRename(directory, destination) {
		t.Fatal("tryRename gave up on a handle that was released during the retries")
	}
	if _, err := os.Stat(filepath.Join(destination, "runtime", "python.exe")); err != nil {
		t.Fatalf("renamed tree is incomplete: %v", err)
	}
}

// A cross-volume rename never succeeds by waiting, so it must not burn the
// retry budget before Move falls through to the copy.
func TestTryRenameDoesNotRetryACrossVolumeMove(t *testing.T) {
	root := os.Getenv("FINOKA_MOVECHECK_DEST")
	if root == "" {
		t.Skip("set FINOKA_MOVECHECK_DEST to a directory on another drive")
	}
	source := filepath.Join(t.TempDir(), "finesub")
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(root, "crossvolume-probe")
	t.Cleanup(func() { _ = os.RemoveAll(destination) })

	started := time.Now()
	if tryRename(source, destination) {
		t.Fatalf("%s and %s turned out to be on one volume", source, destination)
	}
	if waited := time.Since(started); waited > renameBackoff {
		t.Fatalf("a cross-volume rename spent %s retrying", waited)
	}
}
