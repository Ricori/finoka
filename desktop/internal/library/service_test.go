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

// Subtitles adopted from the cloud need somewhere to live before the video is
// anywhere on this machine. The placeholder is an ordinary entry with no source
// file, and importing that file later has to fill the same entry in rather than
// bounce off the fingerprint match.
func TestPlaceholderRecordsMediaWithoutAFileAndImportAttachesIt(t *testing.T) {
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
	stat, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := fileFingerprint(source, stat.Size())
	if err != nil {
		t.Fatal(err)
	}

	placeholder, err := service.AddPlaceholder("demo", fingerprint, 42.5)
	if err != nil || !validID(placeholder.ID) {
		t.Fatalf("placeholder = %#v, %v", placeholder, err)
	}
	listed := service.List()
	if len(listed) != 1 || listed[0].Available || listed[0].SourcePath != "" {
		t.Fatalf("listed placeholder = %#v", listed)
	}
	if again, err := service.AddPlaceholder("demo", fingerprint, 42.5); err != nil || again.ID != placeholder.ID {
		t.Fatalf("second placeholder = %#v, %v", again, err)
	}

	result := service.Import([]string{source})
	entries := service.List()
	if len(entries) != 1 || entries[0].ID != placeholder.ID {
		t.Fatalf("import created a second entry: %#v (%#v)", entries, result)
	}
	if !entries[0].Available || entries[0].SourcePath != source || entries[0].Width != 1920 || !entries[0].ThumbnailAvailable {
		t.Fatalf("attached entry = %#v", entries[0])
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

func TestDeleteDocumentKeepsMediaInLibrary(t *testing.T) {
	root := t.TempDir()
	video := filepath.Join(root, "video.mp4")
	if err := os.WriteFile(video, []byte("media-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 12, Width: 1280, Height: 720, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "data")
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	entry := service.Import([]string{video}).Added[0]
	document := filepath.Join(data, "documents", entry.ID)
	if err := os.MkdirAll(filepath.Join(document, "history"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(document, "document.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(document, "history", "00000000.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteDocument(entry.ID); err != nil {
		t.Fatal(err)
	}
	entries := service.List()
	if len(entries) != 1 || entries[0].ID != entry.ID || entries[0].DocumentAvailable || !entries[0].DocumentRemoved {
		t.Fatalf("media entry after subtitle deletion = %#v", entries)
	}
	if _, err := os.Stat(video); err != nil {
		t.Fatal("deleting subtitles must not remove source media")
	}
	if _, err := os.Stat(document); !os.IsNotExist(err) {
		t.Fatal("subtitle document and history were not removed")
	}
	if err := os.MkdirAll(document, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(document, "document.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	restored := service.List()[0]
	if !restored.DocumentAvailable || restored.DocumentRemoved {
		t.Fatalf("new subtitle document did not restore editable state: %#v", restored)
	}
}

func TestRelinkAcceptsDifferentMediaFingerprint(t *testing.T) {
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
	relinked, err := service.Relink(entry.ID, second)
	if err != nil {
		t.Fatalf("relink different media: %v", err)
	}
	if relinked.SourcePath != second {
		t.Fatalf("relinked source path = %q, want %q", relinked.SourcePath, second)
	}
	if relinked.Fingerprint == entry.Fingerprint {
		t.Fatal("relinked entry kept the original media fingerprint")
	}
}

func TestRelinkSubtitleOnlyEntryKeepsSubtitleFingerprint(t *testing.T) {
	root := t.TempDir()
	video := filepath.Join(root, "associated.mp4")
	if err := os.WriteFile(video, []byte("unrelated-video"), 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 8, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "data")
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := service.AddPlaceholder("subtitles", "subtitle-fingerprint", 8)
	if err != nil {
		t.Fatal(err)
	}
	document := filepath.Join(data, "documents", entry.ID)
	if err := os.MkdirAll(document, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(document, "document.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	relinked, err := service.Relink(entry.ID, video)
	if err != nil {
		t.Fatalf("associate unrelated video: %v", err)
	}
	if relinked.SourcePath != video {
		t.Fatalf("associated source path = %q, want %q", relinked.SourcePath, video)
	}
	if relinked.Fingerprint != entry.Fingerprint {
		t.Fatalf("subtitle fingerprint changed from %q to %q", entry.Fingerprint, relinked.Fingerprint)
	}
	entries := service.List()
	if len(entries) != 1 || entries[0].ID != entry.ID {
		t.Fatalf("association created another local card: %#v", entries)
	}
}

func TestEditorClipsAreNormalizedAndPersisted(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mp4")
	if err := os.WriteFile(source, []byte("media-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	tools := fixtureTools{metadata: Metadata{Duration: 42, HasVideo: true, HasAudio: true}}
	data := filepath.Join(root, "data")
	service, err := newServiceWithTools(data, tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	entry := service.Import([]string{source}).Added[0]
	ok, err := service.SetClips(entry.ID, []Clip{
		{ID: "intro", Name: "开场", T0: 2, T1: 8},
		{ID: "invalid", Name: "无效", T0: 9, T1: 4},
	})
	if err != nil || !ok {
		t.Fatalf("set clips = %v, %v", ok, err)
	}
	clips := service.GetClips(entry.ID)
	if len(clips) != 1 || clips[0].Name != "开场" || clips[0].CreatedAt == 0 {
		t.Fatalf("clips = %#v", clips)
	}
	reloaded, err := New(data)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.GetClips(entry.ID); len(got) != 1 || got[0].ID != "intro" {
		t.Fatalf("reloaded clips = %#v", got)
	}
}

func TestBundledEditorFontsAreCopiedForVideoExport(t *testing.T) {
	tools := fixtureTools{metadata: Metadata{Duration: 1, Width: 16, Height: 16, HasVideo: true}}
	service, err := newServiceWithTools(t.TempDir(), tools, tools)
	if err != nil {
		t.Fatal(err)
	}
	SetBundledFonts(service, map[string][]byte{
		"FZZhunYuan.woff2":     []byte("fzy-font"),
		"JingNanBoBoHei.woff2": []byte("jnb-font"),
	})
	directory := filepath.Join(t.TempDir(), "fonts")
	copied, err := service.copyBundledFonts(directory)
	if err != nil {
		t.Fatal(err)
	}
	if !copied {
		t.Fatal("expected bundled fonts to be copied")
	}
	for name, want := range map[string]string{
		"FZZhunYuan.woff2": "fzy-font", "JingNanBoBoHei.woff2": "jnb-font",
	} {
		data, readErr := os.ReadFile(filepath.Join(directory, name))
		if readErr != nil || string(data) != want {
			t.Fatalf("font %s = %q, %v", name, data, readErr)
		}
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
