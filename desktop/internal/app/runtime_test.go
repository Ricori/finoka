package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSidecarConfigHonoursExplicitPaths(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "run.py")
	vendor := filepath.Join(root, "vendor")
	data := filepath.Join(root, "tasks")
	if err := os.WriteFile(script, []byte("# fixture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(vendor, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(pythonEnvironment, "fixture-python")
	t.Setenv(scriptEnvironment, script)
	t.Setenv(vendorEnvironment, vendor)
	t.Setenv(dataEnvironment, data)

	config, err := SidecarConfig()
	if err != nil {
		t.Fatalf("resolve config: %v", err)
	}
	if config.Executable != "fixture-python" || config.Args[0] != script || config.Args[2] != data || config.Args[4] != vendor {
		t.Fatalf("unexpected config: %#v", config)
	}
}

func TestFirstAvailableExecutablePrefersBundledRuntime(t *testing.T) {
	root := t.TempDir()
	bundled := filepath.Join(root, "python")
	if err := os.WriteFile(bundled, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	if got := firstAvailableExecutable(filepath.Join(root, "missing"), bundled); got != bundled {
		t.Fatalf("expected bundled runtime %q, got %q", bundled, got)
	}
}

func TestFirstConfiguredPathPreservesAbsoluteCandidate(t *testing.T) {
	root := t.TempDir()
	candidate := filepath.Join(root, "resource.py")
	if err := os.WriteFile(candidate, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	const environment = "FINOKA_TEST_RESOURCE_PATH"
	t.Setenv(environment, "")
	if got := firstConfiguredPath(environment, filepath.Join(root, "working"), candidate); got != candidate {
		t.Fatalf("expected absolute candidate %q, got %q", candidate, got)
	}
}

func TestPlatformDataDirectoryUsesFinokaApplicationDataRoot(t *testing.T) {
	windowsRoot := filepath.Join("C:", "Users", "chika", "AppData", "Roaming")
	windows, err := platformDataDirectory("windows", windowsRoot, "")
	if err != nil || windows != filepath.Join(windowsRoot, "Finoka") {
		t.Fatalf("windows data directory = %q, %v", windows, err)
	}
	mac, err := platformDataDirectory("darwin", "", "/Users/chika")
	expectedMac := filepath.Join("/Users/chika", "Library", "Application Support", "Finoka")
	if err != nil || mac != expectedMac {
		t.Fatalf("macOS data directory = %q, %v", mac, err)
	}
	if _, err := platformDataDirectory("linux", "", "/home/chika"); err == nil {
		t.Fatal("unsupported desktop platform was accepted")
	}
}
