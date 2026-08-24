package library

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVideoCacheCopiesIntoManagedRootAndClearPreservesSource(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mp4")
	contents := []byte("video-cache-fixture")
	if err := os.WriteFile(source, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 4, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "Finoka")
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
	service, err := newServiceWithTools(filepath.Join(root, "Finoka"), tools, tools)
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
