package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ricori/finoka/desktop/internal/managedtools"
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
	t.Setenv(managedtools.PythonEnvironment, "fixture-python")
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

func TestFirstUsableExecutablePrefersBundledRuntime(t *testing.T) {
	root := t.TempDir()
	bundled := filepath.Join(root, "python")
	if err := os.WriteFile(bundled, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	usable := func(string) bool { return true }
	if got := firstUsableExecutable(usable, filepath.Join(root, "missing"), bundled); got != bundled {
		t.Fatalf("expected bundled runtime %q, got %q", bundled, got)
	}
}

// An interpreter without httpx/pydantic starts a sidecar that answers requests
// but cannot build its provisioner, which is how the runtime page ended up with
// every button disabled and no way to install the managed Python.
func TestFirstUsableExecutableSkipsInterpretersMissingDependencies(t *testing.T) {
	root := t.TempDir()
	bare := filepath.Join(root, "bare-python")
	equipped := filepath.Join(root, "equipped-python")
	for _, path := range []string{bare, equipped} {
		if err := os.WriteFile(path, []byte("fixture"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	usable := func(candidate string) bool { return candidate == equipped }
	if got := firstUsableExecutable(usable, bare, equipped); got != equipped {
		t.Fatalf("expected the equipped interpreter %q, got %q", equipped, got)
	}
	if got := firstUsableExecutable(func(string) bool { return false }, bare); got != "" {
		t.Fatalf("expected no interpreter, got %q", got)
	}
}

func TestInterpreterProbeRejectsSomethingThatIsNotAnInterpreter(t *testing.T) {
	fake := filepath.Join(t.TempDir(), "python")
	if err := os.WriteFile(fake, []byte("not an interpreter"), 0o700); err != nil {
		t.Fatal(err)
	}
	if interpreterCanRunSidecar(fake) {
		t.Fatal("a file that cannot be executed was accepted as an interpreter")
	}
}

// Only 3.12.x is accepted. Any other interpreter that happens to carry httpx and
// pydantic — 3.11 as much as 3.13 — must still hand over to the managed Python.
func TestInterpreterProbeScriptPinsTheExactVersion(t *testing.T) {
	for _, fragment := range []string{"sys.version_info[:2] == (3, 12)", "import httpx, pydantic"} {
		if !strings.Contains(interpreterProbeScript, fragment) {
			t.Fatalf("probe script lost %q: %s", fragment, interpreterProbeScript)
		}
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
