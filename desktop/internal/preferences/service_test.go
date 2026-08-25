package preferences

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPreferencesPersistValidatedPartialUpdates(t *testing.T) {
	root := t.TempDir()
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	history := []any{map[string]any{"taskId": "task-1", "provider": "local"}}
	updated, err := service.Save(map[string]any{"theme": "light", "sidebarCollapsed": true, "taskHistory": history})
	if err != nil || updated.Theme != "light" || !updated.SidebarCollapsed || updated.LibraryView != "grid" {
		t.Fatalf("updated = %#v, %v", updated, err)
	}
	if len(updated.TaskHistory) != 1 || updated.TaskHistory[0]["taskId"] != "task-1" {
		t.Fatalf("task history = %#v", updated.TaskHistory)
	}
	reloaded, err := New(root)
	if err != nil || !reflect.DeepEqual(reloaded.Get(), updated) {
		t.Fatalf("reloaded = %#v, %v", reloaded.Get(), err)
	}
	if _, err := service.Save(map[string]any{"libraryView": "tiles"}); err == nil {
		t.Fatal("invalid view was accepted")
	}
	info, err := os.Stat(filepath.Join(root, "preferences.json"))
	if err != nil || info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("preferences permissions = %v, %v", info.Mode().Perm(), err)
	}
}

func TestPreferencesDefaultToLightTheme(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got := service.Get().Theme; got != "light" {
		t.Fatalf("theme = %q, want light", got)
	}
}
