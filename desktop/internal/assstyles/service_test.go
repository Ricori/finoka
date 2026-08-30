package assstyles

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sheet = "[V4+ Styles]\nStyle: 注释,思源黑体 Heavy,60\n"

func TestSaveRoundTripsThroughDisk(t *testing.T) {
	root := t.TempDir()
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get() != "" {
		t.Fatalf("expected an empty sheet before the first save, got %q", service.Get())
	}
	if _, err := service.Save(sheet); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "styles.ass"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != sheet {
		t.Fatalf("styles.ass = %q, want %q", data, sheet)
	}
	reopened, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Get() != sheet {
		t.Fatalf("reopened sheet = %q, want %q", reopened.Get(), sheet)
	}
}

func TestSaveRejectsInvalidSheets(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Save(string([]byte{0xff, 0xfe, 0x00})); err == nil {
		t.Fatal("expected invalid UTF-8 to be rejected")
	}
	if _, err := service.Save(strings.Repeat("a", maxSheetBytes+1)); err == nil {
		t.Fatal("expected an oversized sheet to be rejected")
	}
	if service.Get() != "" {
		t.Fatalf("a rejected save must not change the sheet, got %q", service.Get())
	}
}

// A sheet that got mangled on disk must not stop the app from starting.
func TestCorruptSheetLoadsAsEmpty(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "styles.ass"), []byte{0xff, 0xfe}, 0o600); err != nil {
		t.Fatal(err)
	}
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get() != "" {
		t.Fatalf("expected a corrupt sheet to read as empty, got %q", service.Get())
	}
}
