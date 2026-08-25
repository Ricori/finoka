package app

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"testing/fstest"
)

func TestExtractBundledResources(t *testing.T) {
	source := fstest.MapFS{
		"payload/STAGED.json":                  {Data: []byte(`{"schema":1}`)},
		"payload/scripts/run_local_sidecar.py": {Data: []byte("print('ready')\n")},
		"payload/vendor/runtime.json":          {Data: []byte("{}\n")},
	}
	root, err := extractBundledResources(source, "payload", t.TempDir())
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
	again, err := extractBundledResources(source, "payload", filepath.Dir(filepath.Dir(filepath.Dir(root))))
	if err != nil || again != root {
		t.Fatalf("expected stable content-addressed root %q, got %q (%v)", root, again, err)
	}
}
