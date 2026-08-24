package library

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fixtureTools struct {
	metadata Metadata
	err      error
}

func (f fixtureTools) Probe(context.Context, string) (Metadata, error) {
	return f.metadata, f.err
}

func (f fixtureTools) Generate(_ context.Context, _, output string, _ float64) error {
	if f.err != nil {
		return f.err
	}
	return os.WriteFile(output, []byte("jpeg-fixture"), 0o600)
}

func TestImportPersistsLocalPathDeduplicatesAndCreatesThumbnail(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mp4")
	if err := os.WriteFile(source, []byte("media-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 42.5, Width: 1920, Height: 1080, HasVideo: true, HasAudio: true}}
	service, err := newServiceWithTools(filepath.Join(root, "data"), tools, tools)
	if err != nil {
		t.Fatal(err)
	}

	result := service.Import([]string{source, source})
	if len(result.Failed) != 0 || len(result.Added) != 1 {
		t.Fatalf("unexpected import result: %#v", result)
	}
	entries := service.List()
	if len(entries) != 1 {
		t.Fatalf("library size = %d", len(entries))
	}
	entry := entries[0]
	if entry.SourcePath != source || entry.Duration != 42.5 || !entry.ThumbnailAvailable {
		t.Fatalf("unexpected entry: %#v", entry)
	}
	if _, err := os.Stat(filepath.Join(root, "data", filepath.Base(source))); !os.IsNotExist(err) {
		t.Fatal("source media was copied into the application data directory")
	}
	thumbnail, err := service.ThumbnailDataURL(entry.ID)
	if err != nil || !strings.HasPrefix(thumbnail, "data:image/jpeg;base64,") {
		t.Fatalf("thumbnail = %q, %v", thumbnail, err)
	}

	reloaded, err := New(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.List(); len(got) != 1 || got[0].Fingerprint != entry.Fingerprint {
		t.Fatalf("reloaded entries: %#v", got)
	}
	var disk []Entry
	data, err := os.ReadFile(filepath.Join(root, "data", "library.json"))
	if err != nil || json.Unmarshal(data, &disk) != nil || len(disk) != 1 {
		t.Fatalf("invalid persisted library: %s, %v", data, err)
	}
}

func TestImportRejectsUnsupportedUnreadableAndOverlongMedia(t *testing.T) {
	root := t.TempDir()
	textPath := filepath.Join(root, "notes.txt")
	videoPath := filepath.Join(root, "long.mp4")
	for _, path := range []string{textPath, videoPath} {
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	tools := fixtureTools{metadata: Metadata{Duration: maxMediaDuration.Seconds() + 1, HasVideo: true}}
	service, err := newServiceWithTools(filepath.Join(root, "data"), tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	result := service.Import([]string{textPath, videoPath, filepath.Join(root, "missing.mp4")})
	if len(result.Added) != 0 || len(result.Failed) != 3 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(service.List()) != 0 {
		t.Fatal("rejected media entered the library")
	}
}

func TestRenameRelinkAndRemoveManageOnlyIndexedData(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first.mp4")
	second := filepath.Join(root, "second.mp4")
	for _, path := range []string{first, second} {
		if err := os.WriteFile(path, []byte("same-media-fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	tools := fixtureTools{metadata: Metadata{Duration: 12, Width: 1280, Height: 720, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "data")
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	result := service.Import([]string{first})
	entry := result.Added[0]
	renamed, err := service.Rename(entry.ID, "新的标题")
	if err != nil || renamed.Title != "新的标题" {
		t.Fatalf("rename = %#v, %v", renamed, err)
	}
	if err := os.Remove(first); err != nil {
		t.Fatal(err)
	}
	if service.List()[0].Available {
		t.Fatal("missing source should be reported unavailable")
	}
	relinked, err := service.Relink(entry.ID, second)
	if err != nil || relinked.SourcePath != second {
		t.Fatalf("relink = %#v, %v", relinked, err)
	}
	document := filepath.Join(data, "documents", entry.ID)
	if err := os.MkdirAll(document, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(document, "document.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Remove(entry.ID, true); err != nil {
		t.Fatal(err)
	}
	if len(service.List()) != 0 {
		t.Fatal("removed entry remains in library")
	}
	if _, err := os.Stat(second); err != nil {
		t.Fatal("removing library data must not remove source media")
	}
	if _, err := os.Stat(document); !os.IsNotExist(err) {
		t.Fatal("requested document deletion did not occur")
	}
}

func TestRelinkRejectsDifferentMediaFingerprint(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first.mp4")
	second := filepath.Join(root, "second.mp4")
	if err := os.WriteFile(first, []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte("different"), 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 1, HasVideo: true, HasAudio: true}}
	service, err := newServiceWithTools(filepath.Join(root, "data"), tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	entry := service.Import([]string{first}).Added[0]
	if _, err := service.Relink(entry.ID, second); err == nil {
		t.Fatal("different media fingerprint was accepted")
	}
}

func TestLegacyMigrationImportsSourceAndCachedMediaWithoutCopying(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "Nonoka")
	cache := filepath.Join(legacy, "custom-videos")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		t.Fatal(err)
	}
	direct := filepath.Join(root, "direct.mp4")
	cached := filepath.Join(cache, "old-cloud.mp4")
	for _, path := range []string{direct, cached} {
		if err := os.WriteFile(path, []byte(path), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	legacyLibrary := []map[string]any{
		{"id": "old-local", "srcPath": direct, "title": "本地旧视频"},
		{"id": "old-cloud", "srcPath": "", "title": "缓存旧视频", "cloudOnly": true},
		{"id": "missing", "srcPath": filepath.Join(root, "missing.mp4"), "title": "不存在"},
	}
	encoded, _ := json.Marshal(legacyLibrary)
	if err := os.WriteFile(filepath.Join(legacy, "library.json"), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(map[string]any{"cacheDir": cache})
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), config, 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 12, Width: 1280, Height: 720, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "Finoka")
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	service.legacyRoot = legacy
	status := service.LegacyMigrationStatus()
	if !status.Available || status.Entries != 3 || status.LocalMedia != 2 {
		t.Fatalf("status = %#v", status)
	}
	result := service.MigrateLegacyLibrary()
	if result.Imported != 2 || result.Skipped != 1 || len(result.Failed) != 0 {
		t.Fatalf("result = %#v", result)
	}
	entries := service.List()
	if len(entries) != 2 {
		t.Fatalf("entries = %#v", entries)
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.SourcePath, root) || strings.HasPrefix(entry.SourcePath, data) {
			t.Fatalf("migration copied or redirected source: %#v", entry)
		}
	}
	second := service.MigrateLegacyLibrary()
	if second.Imported != 0 || second.Skipped != 3 {
		t.Fatalf("idempotent result = %#v", second)
	}
}
