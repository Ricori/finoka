package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, body := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("create %s: %v", path, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
}

func TestMeasureTotalsRegularFiles(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"runtime/python/python.exe": "0123456789",
		"models/whisper.bin":        "abcde",
	})
	usage := Measure(root)
	if usage.Files != 2 || usage.Bytes != 15 {
		t.Fatalf("usage = %+v, want 2 files and 15 bytes", usage)
	}
}

func TestMoveRelocatesTheWholeTree(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, source, map[string]string{
		"runtime/python/pyvenv.cfg": "home = C:/Python312",
		"models/whisper.bin":        "weights",
	})
	destination := filepath.Join(t.TempDir(), "Nonoka X", "finesub")
	total := Measure(source).Bytes
	reported := int64(0)
	if err := Move(context.Background(), source, destination, total, func(copied int64) { reported = copied }); err != nil {
		t.Fatalf("move: %v", err)
	}
	if reported != total {
		t.Fatalf("reported %d bytes, want %d", reported, total)
	}
	body, err := os.ReadFile(filepath.Join(destination, "runtime", "python", "pyvenv.cfg"))
	if err != nil || string(body) != "home = C:/Python312" {
		t.Fatalf("moved file = %q, %v", body, err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source survived the move: %v", err)
	}
}

// An installation that has not been created yet still has to be relocatable:
// the point is to record where the next install goes.
func TestMoveCreatesADestinationForAMissingSource(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	destination := filepath.Join(t.TempDir(), "Nonoka X", "finesub")
	if err := Move(context.Background(), source, destination, 0, nil); err != nil {
		t.Fatalf("move: %v", err)
	}
	if info, err := os.Stat(destination); err != nil || !info.IsDir() {
		t.Fatalf("destination = %v, %v", info, err)
	}
}

func TestMoveAcceptsAnExistingEmptyDestination(t *testing.T) {
	source := filepath.Join(t.TempDir(), "videos")
	writeTree(t, source, map[string]string{"loc_a.mp4": "frames"})
	destination := filepath.Join(t.TempDir(), "Nonoka X", "videos")
	if err := os.MkdirAll(destination, 0o755); err != nil {
		t.Fatalf("create destination: %v", err)
	}
	if err := Move(context.Background(), source, destination, 6, nil); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, err := os.Stat(filepath.Join(destination, "loc_a.mp4")); err != nil {
		t.Fatalf("moved file missing: %v", err)
	}
}

func TestMoveCancelledLeavesTheSourceIntact(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, source, map[string]string{"models/whisper.bin": "weights"})
	destination := filepath.Join(t.TempDir(), "Nonoka X", "finesub")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := Move(ctx, source, destination, 7, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("move error = %v, want context.Canceled", err)
	}
	if _, statErr := os.Stat(filepath.Join(source, "models", "whisper.bin")); statErr != nil {
		t.Fatalf("source file lost after cancellation: %v", statErr)
	}
	if _, statErr := os.Stat(destination); !os.IsNotExist(statErr) {
		t.Fatalf("destination created despite cancellation: %v", statErr)
	}
}

// The two temporary directories a test gets share a volume, so Move takes its
// rename fast path and never copies. The cross-volume half is exercised here
// directly: that is where progress, cancellation and permissions live.
func TestCopyTreeReportsProgressAndPreservesLayout(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, source, map[string]string{
		"runtime/python/pyvenv.cfg": "home = C:/Python312",
		"models/whisper.bin":        "weights",
	})
	destination := filepath.Join(t.TempDir(), "incoming")
	reported := int64(0)
	if err := copyTree(context.Background(), source, destination, func(copied int64) { reported = copied }); err != nil {
		t.Fatalf("copy: %v", err)
	}
	if want := Measure(source).Bytes; reported != want {
		t.Fatalf("reported %d bytes, want %d", reported, want)
	}
	body, err := os.ReadFile(filepath.Join(destination, "runtime", "python", "pyvenv.cfg"))
	if err != nil || string(body) != "home = C:/Python312" {
		t.Fatalf("copied file = %q, %v", body, err)
	}
	// A copy that stops halfway must not be mistaken for an installation, which
	// is why Move only renames the staging directory into place once this
	// returns without error.
	if _, statErr := os.Stat(filepath.Join(destination, "models", "whisper.bin")); statErr != nil {
		t.Fatalf("copied file missing: %v", statErr)
	}
}

func TestCopyTreeStopsOnCancellation(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, source, map[string]string{"models/whisper.bin": "weights"})
	destination := filepath.Join(t.TempDir(), "incoming")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := copyTree(ctx, source, destination, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("copy error = %v, want context.Canceled", err)
	}
	if _, statErr := os.Stat(filepath.Join(source, "models", "whisper.bin")); statErr != nil {
		t.Fatalf("source file lost after cancellation: %v", statErr)
	}
}

// A copy that already carried gigabytes across must never be thrown away and
// repeated: the second attempt takes what is already in place.
func TestCopyTreeResumesFilesAlreadyInPlace(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, source, map[string]string{
		"models/whisper.bin": "weights",
		"runtime/python.exe": "interpreter",
	})
	destination := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, destination, map[string]string{"models/whisper.bin": "weights"})
	carried := filepath.Join(destination, "models", "whisper.bin")
	before, err := os.Stat(carried)
	if err != nil {
		t.Fatal(err)
	}

	reported := int64(0)
	if err := copyTree(context.Background(), source, destination, func(copied int64) { reported = copied }); err != nil {
		t.Fatalf("copy: %v", err)
	}
	// Progress counts the resumed bytes: a bar that restarts at zero reads as
	// "it lost everything".
	if want := Measure(source).Bytes; reported != want {
		t.Fatalf("reported %d bytes, want %d", reported, want)
	}
	after, err := os.Stat(carried)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("a file already in place was copied again")
	}
	if body, readErr := os.ReadFile(filepath.Join(destination, "runtime", "python.exe")); readErr != nil || string(body) != "interpreter" {
		t.Fatalf("missing file was not copied: %q, %v", body, readErr)
	}
}

// A half-written file must not survive to be trusted by the size check a
// resumed copy relies on.
func TestCopyFileRemovesATruncatedFileOnCancellation(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "large.bin")
	if err := os.WriteFile(source, make([]byte, 4*copyBufferSize), 0o600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(root, "large.copy")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := copyFile(ctx, source, destination, 0o644, make([]byte, copyBufferSize)); !errors.Is(err, context.Canceled) {
		t.Fatalf("copy error = %v, want context.Canceled", err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("truncated file survived: %v", err)
	}
}

func TestMoveKeepsAPartialCopyForTheNextAttempt(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	writeTree(t, source, map[string]string{"models/whisper.bin": "weights"})
	// A destination on the same volume would be renamed, so the partial-copy
	// path is driven through copyTree plus the marker Move writes.
	destination := filepath.Join(t.TempDir(), "Nonoka X", "finesub")
	if err := os.MkdirAll(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writePartial(source, destination); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(destination, "models"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(destination, "models", "whisper.bin"), []byte("weights"), 0o600); err != nil {
		t.Fatal(err)
	}

	carried, resumable := ResumableCopy(source, destination)
	if !resumable || carried.Bytes != 7 {
		t.Fatalf("resumable = %v with %+v, want the partial copy recognised", resumable, carried)
	}
	// A marker naming a different source belongs to some other relocation.
	if _, wrong := ResumableCopy(filepath.Join(t.TempDir(), "videos"), destination); wrong {
		t.Fatal("a marker for another source was adopted")
	}

	if err := Move(context.Background(), source, destination, 7, nil); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, err := os.Stat(partialMarker(destination)); !os.IsNotExist(err) {
		t.Fatalf("marker survived a completed move: %v", err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source survived the move: %v", err)
	}
	if _, resumable := ResumableCopy(source, destination); resumable {
		t.Fatal("a completed destination is still reported as resumable")
	}
}

func TestDiscardPartialCopyOnlyRemovesItsOwn(t *testing.T) {
	source := filepath.Join(t.TempDir(), "finesub")
	destination := filepath.Join(t.TempDir(), "Nonoka X", "finesub")
	writeTree(t, destination, map[string]string{"models/whisper.bin": "weights"})
	other := filepath.Join(t.TempDir(), "videos")

	if err := DiscardPartialCopy(source, destination); err != nil {
		t.Fatalf("discard without a marker: %v", err)
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatalf("an unmarked directory was removed: %v", err)
	}

	if err := writePartial(source, destination); err != nil {
		t.Fatal(err)
	}
	if err := DiscardPartialCopy(other, destination); err != nil {
		t.Fatalf("discard for another source: %v", err)
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatalf("another relocation's copy was removed: %v", err)
	}

	if err := DiscardPartialCopy(source, destination); err != nil {
		t.Fatalf("discard: %v", err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("partial copy survived the discard: %v", err)
	}
	if _, err := os.Stat(partialMarker(destination)); !os.IsNotExist(err) {
		t.Fatalf("marker survived the discard: %v", err)
	}
}

func TestFreeSpaceReportsTheVolumeOfAMissingDirectory(t *testing.T) {
	// The destination of a relocation does not exist yet, so the answer has to
	// come from the nearest ancestor that does.
	if FreeSpace(filepath.Join(t.TempDir(), "Nonoka X", "finesub")) <= 0 {
		t.Fatal("free space on the test volume reported as zero")
	}
}
