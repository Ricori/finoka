package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ricori/nonoka-x/desktop/internal/storage"
)

func waitForIdle(t *testing.T, service *StorageService) RelocationProgress {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		progress := service.Progress()
		if !progress.Active && progress.Stage != "preparing" {
			return progress
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("relocation did not finish")
	return RelocationProgress{}
}

// The video cache is the target that needs no sidecar, so the whole
// move-record-apply sequence can be exercised without one.
func TestRelocateMovesTheVideoCacheAndRecordsIt(t *testing.T) {
	data := t.TempDir()
	source := storage.Default(data, storage.VideoTarget)
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "loc_a.mp4"), []byte("frames"), 0o600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "Nonoka X", "videos")

	service := NewStorageService(data, nil, nil)
	if _, err := service.Relocate(storage.VideoTarget, destination); err != nil {
		t.Fatalf("relocate: %v", err)
	}
	progress := waitForIdle(t, service)
	if progress.Stage != "completed" {
		t.Fatalf("progress = %+v, want a completed move", progress)
	}
	if _, err := os.Stat(filepath.Join(destination, "loc_a.mp4")); err != nil {
		t.Fatalf("cached file did not arrive: %v", err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("old directory survived: %v", err)
	}
	if got := storage.VideoDirectory(data); got != destination {
		t.Fatalf("recorded directory = %q, want %q", got, destination)
	}

	status := service.Status()
	video := status.Locations[1]
	if video.Target != storage.VideoTarget || !video.Custom || video.Directory != destination {
		t.Fatalf("status video location = %+v", video)
	}
	// The runtime half must be untouched by a video relocation.
	if runtimeLocation := status.Locations[0]; runtimeLocation.Custom {
		t.Fatalf("runtime location changed: %+v", runtimeLocation)
	}
}

func TestResetLocationMovesTheCacheBack(t *testing.T) {
	data := t.TempDir()
	elsewhere := filepath.Join(t.TempDir(), "Nonoka X", "videos")
	if err := os.MkdirAll(elsewhere, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(elsewhere, "loc_a.mp4"), []byte("frames"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.Set(data, storage.VideoTarget, elsewhere); err != nil {
		t.Fatal(err)
	}

	service := NewStorageService(data, nil, nil)
	if _, err := service.ResetLocation(storage.VideoTarget); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if progress := waitForIdle(t, service); progress.Stage != "completed" {
		t.Fatalf("progress = %+v, want a completed move", progress)
	}
	fallback := storage.Default(data, storage.VideoTarget)
	if _, err := os.Stat(filepath.Join(fallback, "loc_a.mp4")); err != nil {
		t.Fatalf("cached file did not come back: %v", err)
	}
	if storage.Load(data).VideoDir != "" {
		t.Fatalf("record still names a custom directory: %+v", storage.Load(data))
	}
}

func TestRelocateRejectsADestinationInsideTheSourceBeforeMoving(t *testing.T) {
	data := t.TempDir()
	source := storage.Default(data, storage.VideoTarget)
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewStorageService(data, nil, nil)
	if _, err := service.Relocate(storage.VideoTarget, filepath.Join(source, "nested")); err == nil {
		t.Fatal("a destination inside the source was accepted")
	}
	if progress := service.Progress(); progress.Active || progress.Stage != "idle" {
		t.Fatalf("a rejected request started a move: %+v", progress)
	}
}

// The install page offers to redirect the runtime before it is downloaded, so
// "nothing here yet" and "this drive is big enough" have to be answerable
// before anything exists.
func TestStatusDescribesAnEmptyRuntimeTargetForTheInstallPage(t *testing.T) {
	data := t.TempDir()
	service := NewStorageService(data, nil, nil)

	runtimeLocation := service.Status().Locations[0]
	if runtimeLocation.Target != storage.RuntimeTarget {
		t.Fatalf("first location is %q, want the runtime", runtimeLocation.Target)
	}
	if !runtimeLocation.Empty {
		t.Fatalf("a data directory with no install reported Empty=false: %+v", runtimeLocation)
	}
	if runtimeLocation.Estimated != estimatedRuntimeBytes {
		t.Fatalf("estimated = %d, want %d", runtimeLocation.Estimated, estimatedRuntimeBytes)
	}
	if want := runtimeLocation.FreeBytes >= runtimeLocation.Estimated; runtimeLocation.EnoughSpace != want {
		t.Fatalf("enoughSpace = %v with %d free against %d needed", runtimeLocation.EnoughSpace, runtimeLocation.FreeBytes, runtimeLocation.Estimated)
	}

	// The video cache has no download to size up, so it never warns about room.
	videoLocation := service.Status().Locations[1]
	if videoLocation.Estimated != 0 || !videoLocation.EnoughSpace {
		t.Fatalf("video location = %+v, want no estimate and no warning", videoLocation)
	}

	// FineSub's own marker files land in a fresh install root; they must not
	// make it look installed.
	root := storage.Default(data, storage.RuntimeTarget)
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".finesub-store.json"), []byte(`{"schema":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	service.forget()
	if !service.Status().Locations[0].Empty {
		t.Fatal("a store marker made an empty install root look installed")
	}

	// A real download does.
	installed, err := os.Create(filepath.Join(root, "models.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := installed.Truncate(emptyInstallThreshold + 1); err != nil {
		t.Fatal(err)
	}
	if err := installed.Close(); err != nil {
		t.Fatal(err)
	}
	service.forget()
	if service.Status().Locations[0].Empty {
		t.Fatal("an installed runtime still reported Empty=true")
	}
}
