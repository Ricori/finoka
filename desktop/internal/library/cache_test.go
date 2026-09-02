package library

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Ricori/nonoka-x/desktop/internal/storage"
)

func TestVideoCacheCopiesIntoManagedRootAndClearPreservesSource(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mp4")
	contents := []byte("video-cache-fixture")
	if err := os.WriteFile(source, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 4, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "Nonoka X")
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	entry := service.Import([]string{source}).Added[0]
	cached, err := service.CacheMedia(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(cached) != filepath.Join(data, "videos") {
		t.Fatalf("cache escaped managed directory: %q", cached)
	}
	if status := service.CacheStatus(); status.Files != 1 || status.Bytes != int64(len(contents)) || status.LimitGB != defaultCacheLimitGB {
		t.Fatalf("cache status = %#v", status)
	}
	status, err := service.ClearVideoCache()
	if err != nil || status.Files != 0 {
		t.Fatalf("clear cache = %#v, %v", status, err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("cache clear removed the original source")
	}
	cached, err = service.CacheMedia(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(source); err != nil {
		t.Fatal(err)
	}
	resolved, _, _, _, err := service.ResolveMedia(entry.ID)
	if err != nil || resolved != cached {
		t.Fatalf("resolved cached media = %q, %v", resolved, err)
	}
	status, err = service.ClearVideoCache()
	if err != nil || status.Files != 0 {
		t.Fatalf("clear cache = %#v, %v", status, err)
	}
}

func TestCacheConvergenceUsesLRUAndProtectsActiveEditor(t *testing.T) {
	root := t.TempDir()
	tools := fixtureTools{metadata: Metadata{Duration: 4, HasVideo: true, HasAudio: true}}
	service, err := newServiceWithTools(filepath.Join(root, "Nonoka X"), tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for index, name := range []string{"first.mp4", "second.mp4"} {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte{name[0], byte(index)}, 0o600); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, service.Import([]string{path}).Added[0].ID)
	}
	service.mu.Lock()
	service.entries[0].LastAccess = 200
	service.entries[1].LastAccess = 100
	service.mu.Unlock()
	for _, id := range ids {
		if err := os.WriteFile(filepath.Join(service.cacheDir, id+".mp4"), []byte("12345678"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(service.cacheDir, "abandoned.mp4.part"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.SetActiveMedia(ids[0]); err != nil {
		t.Fatal(err)
	}
	service.cacheConfig.LimitGB = float64(8) / float64(bytesPerGB)
	if err := service.convergeCache(); err != nil {
		t.Fatal(err)
	}
	if service.cachedPath(ids[0]) == "" {
		t.Fatal("active editor cache was evicted")
	}
	if service.cachedPath(ids[1]) != "" {
		t.Fatal("least recently used cache was retained")
	}
	if _, err := os.Stat(filepath.Join(service.cacheDir, "abandoned.mp4.part")); !os.IsNotExist(err) {
		t.Fatal("stale partial cache was not removed")
	}
}

func TestCacheLimitPersists(t *testing.T) {
	root := t.TempDir()
	service, err := newService(root, commandMediaTools{})
	if err != nil {
		t.Fatal(err)
	}
	status, err := service.SetCacheLimitGB(36)
	if err != nil || status.LimitGB != 36 {
		t.Fatalf("set limit = %#v, %v", status, err)
	}
	reloaded, err := newService(root, commandMediaTools{})
	if err != nil || reloaded.CacheStatus().LimitGB != 36 {
		t.Fatalf("reloaded cache limit = %#v, %v", reloaded.CacheStatus(), err)
	}
	if _, err := service.SetCacheLimitGB(0); err == nil {
		t.Fatal("invalid cache limit was accepted")
	}
}

// The video cache is the half of Nonoka X's disk use a user can move without
// touching the runtime, so a recorded location has to be honoured from the
// first import onward — not only after SetCacheDirectory retargets a running
// service.
func TestVideoCacheHonoursARelocatedDirectory(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mp4")
	if err := os.WriteFile(source, []byte("relocated-cache-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "Nonoka X")
	elsewhere := filepath.Join(t.TempDir(), "Nonoka X", "videos")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.Set(data, storage.VideoTarget, elsewhere); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 4, HasVideo: true, HasAudio: true}}
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	entry := service.Import([]string{source}).Added[0]
	cached, err := service.CacheMedia(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(cached) != elsewhere {
		t.Fatalf("working copy landed in %q, want %q", filepath.Dir(cached), elsewhere)
	}
	if status := service.CacheStatus(); status.Directory != elsewhere {
		t.Fatalf("cache status directory = %q, want %q", status.Directory, elsewhere)
	}
	// Moving the cache again while the service is running has to take the
	// existing working copies' directory with it.
	moved := filepath.Join(t.TempDir(), "Nonoka X", "videos")
	if err := os.MkdirAll(filepath.Dir(moved), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(elsewhere, moved); err != nil {
		t.Fatal(err)
	}
	if err := SetCacheDirectory(service, moved); err != nil {
		t.Fatal(err)
	}
	if status := service.CacheStatus(); status.Directory != moved || status.Files != 1 {
		t.Fatalf("cache status after retarget = %#v", status)
	}
}
