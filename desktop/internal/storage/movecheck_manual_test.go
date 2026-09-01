package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// Runs only when FINOKA_MOVECHECK_DEST names a directory on another volume.
func TestManualCrossVolumeMoveCancelAndResume(t *testing.T) {
	root := os.Getenv("FINOKA_MOVECHECK_DEST")
	if root == "" {
		t.Skip("set FINOKA_MOVECHECK_DEST to a directory on another drive")
	}
	source := filepath.Join(t.TempDir(), "finesub")
	destination := filepath.Join(root, "movecheck")
	t.Cleanup(func() {
		_ = os.RemoveAll(destination)
		_ = os.Remove(partialMarker(destination))
	})

	for _, dir := range []string{"runtime/python/Scripts", "models", "cache"} {
		if err := os.MkdirAll(filepath.Join(source, filepath.FromSlash(dir)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	big := make([]byte, 5<<20)
	for i := range big {
		big[i] = byte(i)
	}
	for _, name := range []string{"runtime/python/Scripts/python.exe", "models/whisper.bin"} {
		if err := os.WriteFile(filepath.Join(source, filepath.FromSlash(name)), big, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, ".finesub-store.json"), []byte(`{"schema":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	total := Measure(source).Bytes
	t.Logf("source %s: %d bytes", source, total)

	ctx, cancel := context.WithCancel(context.Background())
	err := Move(ctx, source, destination, total, func(copied int64) {
		if copied >= total/2 {
			cancel()
		}
	})
	t.Logf("cancelled move -> %v", err)
	carried, resumable := ResumableCopy(source, destination)
	t.Logf("resumable=%v carried=%d", resumable, carried.Bytes)
	if !resumable || carried.Bytes == 0 {
		t.Fatal("the cancelled copy was discarded instead of kept for resume")
	}
	if _, statErr := os.Stat(filepath.Join(source, "models", "whisper.bin")); statErr != nil {
		t.Fatalf("source damaged: %v", statErr)
	}

	last := int64(0)
	if err := Move(context.Background(), source, destination, total, func(copied int64) { last = copied }); err != nil {
		t.Fatalf("resumed move: %v", err)
	}
	t.Logf("resumed move reported %d of %d", last, total)
	if moved := Measure(destination); moved.Bytes != total {
		t.Fatalf("destination holds %d bytes, want %d", moved.Bytes, total)
	}
	if _, statErr := os.Stat(source); !os.IsNotExist(statErr) {
		t.Fatalf("source survived: %v", statErr)
	}
	if _, statErr := os.Stat(partialMarker(destination)); !os.IsNotExist(statErr) {
		t.Fatal("marker survived a completed move")
	}
	body, readErr := os.ReadFile(filepath.Join(destination, "runtime", "python", "Scripts", "python.exe"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(body) != len(big) {
		t.Fatalf("payload is %d bytes, want %d", len(body), len(big))
	}
	for i := range body {
		if body[i] != big[i] {
			t.Fatalf("payload corrupted at byte %d", i)
		}
	}
}
