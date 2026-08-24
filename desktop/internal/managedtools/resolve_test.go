package managedtools

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFindManagedUsesActiveVerifiedResource(t *testing.T) {
	root := t.TempDir()
	name := "ffprobe"
	filename := name
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	resource := filepath.Join(root, "finesub", "runtime", name)
	active := filepath.Join(resource, "9.0.1")
	if err := os.MkdirAll(active, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(active, filename)
	if err := os.WriteFile(executable, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resource, "current.json"), []byte(`{"current":"9.0.1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := findManaged(root, name); got != executable {
		t.Fatalf("managed tool = %q, want %q", got, executable)
	}
}

func TestFindManagedRejectsUnsafeVersionPointer(t *testing.T) {
	root := t.TempDir()
	resource := filepath.Join(root, "finesub", "runtime", "ffmpeg")
	if err := os.MkdirAll(resource, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resource, "current.json"), []byte(`{"current":"../escape"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := findManaged(root, "ffmpeg"); got != "" {
		t.Fatalf("unsafe pointer resolved to %q", got)
	}
}
