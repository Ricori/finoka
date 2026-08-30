package preferences

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestPreferencesPersistValidatedPartialUpdates(t *testing.T) {
	root := t.TempDir()
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.Save(map[string]any{"homeTheme": "dark", "editorTheme": "light", "sidebarCollapsed": true})
	if err != nil || updated.HomeTheme != "dark" || updated.EditorTheme != "light" || !updated.SidebarCollapsed || updated.LibraryView != "grid" {
		t.Fatalf("updated = %#v, %v", updated, err)
	}
	reloaded, err := New(root)
	if err != nil || !reflect.DeepEqual(reloaded.Get(), updated) {
		t.Fatalf("reloaded = %#v, %v", reloaded.Get(), err)
	}
	if _, err := service.Save(map[string]any{"libraryView": "tiles"}); err == nil {
		t.Fatal("invalid view was accepted")
	}
	info, err := os.Stat(filepath.Join(root, "preferences.json"))
	if err != nil || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		t.Fatalf("preferences permissions = %v, %v", info.Mode().Perm(), err)
	}
}

func TestPreferencesDefaultsEditorToDarkTheme(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	state := service.Get()
	if state.HomeTheme != "light" || state.EditorTheme != "dark" {
		t.Fatalf("themes = %q / %q, want light / dark", state.HomeTheme, state.EditorTheme)
	}
}

func TestPreferencesSaveWindowThemesIndependently(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	state, err := service.Save(map[string]any{"editorTheme": "dark"})
	if err != nil {
		t.Fatal(err)
	}
	if state.HomeTheme != "light" || state.EditorTheme != "dark" {
		t.Fatalf("themes = %q / %q, want light / dark", state.HomeTheme, state.EditorTheme)
	}
	state, err = service.Save(map[string]any{"homeTheme": "dark"})
	if err != nil {
		t.Fatal(err)
	}
	if state.HomeTheme != "dark" || state.EditorTheme != "dark" {
		t.Fatalf("themes = %q / %q, want dark / dark", state.HomeTheme, state.EditorTheme)
	}
}
