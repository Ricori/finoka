package app

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"testing/fstest"
	"time"
)

const testStagedManifest = `{"schema":1,"files":[` +
	`{"path":"scripts/run_local_sidecar.py","sha256":"","size":15},` +
	`{"path":"vendor/runtime.json","sha256":"","size":3}]}`

func testResourceSource() fstest.MapFS {
	return fstest.MapFS{
		"payload/STAGED.json":                  {Data: []byte(testStagedManifest)},
		"payload/scripts/run_local_sidecar.py": {Data: []byte("print('ready')\n")},
		"payload/vendor/runtime.json":          {Data: []byte("{}\n")},
	}
}

func TestExtractBundledResources(t *testing.T) {
	source := testResourceSource()
	dataDirectory := t.TempDir()
	root, err := extractBundledResources(source, "payload", dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(filepath.Join(root, "scripts", "run_local_sidecar.py"))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "print('ready')\n" {
		t.Fatalf("unexpected extracted script: %q", contents)
	}
	if info, err := os.Stat(filepath.Join(root, "vendor", "runtime.json")); err != nil || (runtime.GOOS != "windows" && info.Mode().Perm() != fs.FileMode(0o600)) {
		t.Fatalf("expected private embedded resource, info=%v err=%v", info, err)
	}
	if _, err := os.Stat(root + ".staging"); !os.IsNotExist(err) {
		t.Fatalf("expected the staging directory to be renamed into place, err=%v", err)
	}
	again, err := extractBundledResources(source, "payload", dataDirectory)
	if err != nil || again != root {
		t.Fatalf("expected stable content-addressed root %q, got %q (%v)", root, again, err)
	}
}

// A tree that lost files after its manifest was committed is the failure this
// repairs: without it the matching manifest is taken as proof, and the sidecar
// script stays missing on every later launch.
func TestExtractBundledResourcesRepairsDamagedTree(t *testing.T) {
	source := testResourceSource()
	dataDirectory := t.TempDir()
	root, err := extractBundledResources(source, "payload", dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(root, "scripts", "run_local_sidecar.py")
	if err := os.RemoveAll(filepath.Dir(script)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "vendor", "runtime.json"), []byte("truncated"), 0o600); err != nil {
		t.Fatal(err)
	}
	repaired, err := extractBundledResources(source, "payload", dataDirectory)
	if err != nil || repaired != root {
		t.Fatalf("expected the damaged tree repaired in place, got %q (%v)", repaired, err)
	}
	if contents, err := os.ReadFile(script); err != nil || string(contents) != "print('ready')\n" {
		t.Fatalf("expected the sidecar script restored, contents=%q err=%v", contents, err)
	}
	if contents, err := os.ReadFile(filepath.Join(root, "vendor", "runtime.json")); err != nil || string(contents) != "{}\n" {
		t.Fatalf("expected the truncated resource restored, contents=%q err=%v", contents, err)
	}
}

func TestExtractBundledResourcesPrunesOldVersions(t *testing.T) {
	source := testResourceSource()
	dataDirectory := t.TempDir()
	root, err := extractBundledResources(source, "payload", dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	base := filepath.Dir(filepath.Dir(root))
	now := time.Now()
	for index, name := range []string{"0000000000000001", "0000000000000002", "0000000000000003"} {
		previous := filepath.Join(base, name, "finoka")
		if err := os.MkdirAll(previous, 0o700); err != nil {
			t.Fatal(err)
		}
		stamp := now.Add(-time.Duration(index+1) * time.Hour)
		if err := os.Chtimes(filepath.Join(base, name), stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := extractBundledResources(source, "payload", dataDirectory); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		t.Fatal(err)
	}
	remaining := make([]string, 0, len(entries))
	for _, entry := range entries {
		remaining = append(remaining, entry.Name())
	}
	if len(remaining) != retainedResourceVersions {
		t.Fatalf("expected %d retained versions, got %v", retainedResourceVersions, remaining)
	}
	if _, err := os.Stat(filepath.Join(base, "0000000000000001", "finoka")); err != nil {
		t.Fatalf("expected the newest spare version retained: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("expected the running version retained: %v", err)
	}
}
