package library

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildTranscodeArgs(t *testing.T) {
	args := strings.Join(buildTranscodeArgs(`D:\hevc.mkv`, `D:\cache\video.mp4.h264.part`), " ")
	for _, expected := range []string{
		"-c:v libx264", "-pix_fmt yuv420p", "-c:a aac", "-movflags +faststart",
		"-f mp4", "-progress pipe:1", `D:\cache\video.mp4.h264.part`,
	} {
		if !strings.Contains(args, expected) {
			t.Fatalf("%q missing from %q", expected, args)
		}
	}
}

func TestParseTranscodeProgress(t *testing.T) {
	done, ok := parseTranscodeProgress("out_time_us=12500000", 20)
	if !ok || done != 12.5 {
		t.Fatalf("progress = %v, %v; want 12.5, true", done, ok)
	}
	done, ok = parseTranscodeProgress("out_time_us=25000000", 20)
	if !ok || done != 20 {
		t.Fatalf("clamped progress = %v, %v; want 20, true", done, ok)
	}
}

func TestTranscodeSourcePrefersOriginalOverCache(t *testing.T) {
	root := t.TempDir()
	id := "loc_0123456789ab"
	source := filepath.Join(root, "original.mkv")
	cacheDir := filepath.Join(root, "videos")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(cacheDir, id+".mkv")
	if err := os.WriteFile(cache, []byte("cached"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &Service{cacheDir: cacheDir, entries: []Entry{{ID: id, SourcePath: source}}}
	if path, err := service.transcodeSource(id); err != nil || path != source {
		t.Fatalf("path=%q err=%v", path, err)
	}

	service.entries[0].SourcePath = filepath.Join(root, "missing.mkv")
	if path, err := service.transcodeSource(id); err != nil || path != cache {
		t.Fatalf("path=%q err=%v", path, err)
	}
}

func TestInstallTranscodedReplacesExistingCache(t *testing.T) {
	root := t.TempDir()
	id := "loc_0123456789ab"
	cacheDir := filepath.Join(root, "videos")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	oldCache := filepath.Join(cacheDir, id+".mkv")
	destination := filepath.Join(cacheDir, id+".mp4")
	part := destination + ".h264.part"
	if err := os.WriteFile(oldCache, []byte("hevc"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(part, []byte("h264"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &Service{
		root: root, indexPath: filepath.Join(root, "library.json"), cacheDir: cacheDir,
		entries: []Entry{{ID: id}}, cacheConfig: defaultCacheConfig(),
	}
	if err := service.installTranscoded(id, part, destination); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "h264" {
		t.Fatalf("cache copy = %q, %v", data, err)
	}
	if fileExists(oldCache) || fileExists(part) {
		t.Fatal("old cache or temporary file was not removed")
	}
}

func TestCancelTranscode(t *testing.T) {
	id := "loc_0123456789ab"
	service := &Service{transcodeCancels: make(map[string]context.CancelFunc)}
	cancelled := false
	service.transcodeCancels[id] = func() { cancelled = true }
	if err := service.CancelTranscode("invalid"); err == nil {
		t.Fatal("expected error for invalid id")
	}
	if err := service.CancelTranscode(id); err != nil {
		t.Fatal(err)
	}
	if !cancelled {
		t.Fatal("expected cancel func to be called")
	}
}
