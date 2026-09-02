package managedtools

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestFindManagedUsesActiveVerifiedResource(t *testing.T) {
	root := t.TempDir()
	name := "ffprobe"
	filename := name
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	resource := filepath.Join(root, "finesub", "runtime", name)
	active := filepath.Join(resource, "9.0.1")
	if err := os.MkdirAll(active, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(active, filename)
	if err := os.WriteFile(executable, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resource, "current.json"), []byte(`{"current":"9.0.1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := findManaged(root, name); got != executable {
		t.Fatalf("managed tool = %q, want %q", got, executable)
	}
}

func TestFindManagedRejectsUnsafeVersionPointer(t *testing.T) {
	root := t.TempDir()
	resource := filepath.Join(root, "finesub", "runtime", "ffmpeg")
	if err := os.MkdirAll(resource, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resource, "current.json"), []byte(`{"current":"../escape"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := findManaged(root, "ffmpeg"); got != "" {
		t.Fatalf("unsafe pointer resolved to %q", got)
	}
}

// The version is arbitrary: nothing parses it, it only has to be a safe
// directory name. It deliberately does not track any real yt-dlp release.
const fixtureVersion = "1.2.3"

// writeYTDLPWheel lays out the wheel exactly as the provisioner does: an
// unpacked package directory plus the version pointer beside it. It returns the
// directory PYTHONPATH has to name for "import yt_dlp" to resolve.
func writeYTDLPWheel(t *testing.T, root, version string) string {
	t.Helper()
	resource := filepath.Join(root, "finesub", "runtime", "yt-dlp")
	packageRoot := filepath.Join(resource, version)
	// __init__.py is the file the runtime manifest marks as required; __main__.py
	// is what -m runs. A real wheel carries both.
	for _, name := range []string{"__init__.py", "__main__.py"} {
		module := filepath.Join(packageRoot, "yt_dlp", name)
		if err := os.MkdirAll(filepath.Dir(module), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(module, []byte("# fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	pointer := filepath.Join(resource, "current.json")
	if err := os.WriteFile(pointer, []byte(`{"current":"`+version+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return packageRoot
}

// writeBootstrapPython asks BootstrapPython for the path rather than repeating
// the layout, so a change to that layout moves the fixture with it.
func writeBootstrapPython(t *testing.T, root string) string {
	t.Helper()
	python := BootstrapPython(root)
	if err := os.MkdirAll(filepath.Dir(python), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(python, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	return python
}

// A wheel with no executable resolves to the managed interpreter importing the
// package off PYTHONPATH -- the case that was silently broken.
func TestFindYTDLPRunsWheelThroughManagedPython(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", "")
	t.Setenv(PythonEnvironment, "")
	t.Setenv("PYTHONPATH", "")
	packageRoot := writeYTDLPWheel(t, root, fixtureVersion)
	python := writeBootstrapPython(t, root)

	ytDLP, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if ytDLP.Executable != python {
		t.Fatalf("executable = %q, want the managed interpreter %q", ytDLP.Executable, python)
	}
	if want := []string{"-s", "-m", "yt_dlp"}; !slices.Equal(ytDLP.Prefix, want) {
		t.Fatalf("prefix = %q, want %q", ytDLP.Prefix, want)
	}
	if want := []string{"PYTHONPATH=" + packageRoot}; !slices.Equal(ytDLP.Environment, want) {
		t.Fatalf("environment = %q, want %q", ytDLP.Environment, want)
	}
}

// An inherited PYTHONPATH is kept behind the wheel instead of being dropped,
// so a developer pointing at a checkout keeps whatever else they had on it.
func TestFindYTDLPKeepsInheritedPythonPath(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", "")
	t.Setenv(PythonEnvironment, "")
	t.Setenv("PYTHONPATH", "inherited")
	packageRoot := writeYTDLPWheel(t, root, fixtureVersion)
	writeBootstrapPython(t, root)

	ytDLP, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	want := []string{"PYTHONPATH=" + packageRoot + string(os.PathListSeparator) + "inherited"}
	if !slices.Equal(ytDLP.Environment, want) {
		t.Fatalf("environment = %q, want %q", ytDLP.Environment, want)
	}
}

// A real binary still wins, so swapping the resource back to a standalone
// build keeps working without touching this package.
func TestFindYTDLPPrefersNativeExecutable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", "")
	t.Setenv(PythonEnvironment, "")
	packageRoot := writeYTDLPWheel(t, root, fixtureVersion)
	writeBootstrapPython(t, root)
	filename := "yt-dlp"
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	native := filepath.Join(packageRoot, filename)
	if err := os.WriteFile(native, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}

	ytDLP, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if ytDLP.Executable != native {
		t.Fatalf("executable = %q, want the native binary %q", ytDLP.Executable, native)
	}
	if len(ytDLP.Prefix) != 0 || len(ytDLP.Environment) != 0 {
		t.Fatalf("a native binary needs no interpreter wiring, got prefix %q env %q", ytDLP.Prefix, ytDLP.Environment)
	}
}

// An explicit NONOKA_PYTHON outranks the bundled interpreter, which is what
// packaged builds and development checkouts rely on.
func TestFindYTDLPHonoursPythonOverride(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", "")
	writeYTDLPWheel(t, root, fixtureVersion)
	writeBootstrapPython(t, root)
	override := filepath.Join(t.TempDir(), "custom-python")
	if err := os.WriteFile(override, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(PythonEnvironment, override)

	ytDLP, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if ytDLP.Executable != override {
		t.Fatalf("executable = %q, want the %s override %q", ytDLP.Executable, PythonEnvironment, override)
	}
}

// SidecarConfig accepts a bare command name in NONOKA_PYTHON, so this resolver
// has to as well: silently falling through to a different interpreter than the
// sidecar runs is worse than either honouring or rejecting the value.
func TestFindYTDLPResolvesPythonOverrideOnPath(t *testing.T) {
	root := t.TempDir()
	writeYTDLPWheel(t, root, fixtureVersion)
	writeBootstrapPython(t, root)
	directory := t.TempDir()
	name := "nonoka-fixture-python"
	if runtime.GOOS == "windows" {
		name += ".bat"
		t.Setenv("PATHEXT", ".BAT")
	}
	onPath := filepath.Join(directory, name)
	if err := os.WriteFile(onPath, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory)
	t.Setenv(PythonEnvironment, name)

	ytDLP, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if ytDLP.Executable != onPath {
		t.Fatalf("executable = %q, want the interpreter found on PATH %q", ytDLP.Executable, onPath)
	}
}

// A missing interpreter and a missing yt-dlp are different problems: the host
// used to report both as "yt-dlp is not installed", sending users to install
// something they already had.
func TestFindYTDLPSeparatesMissingInterpreterFromMissingWheel(t *testing.T) {
	// yt-dlp is present, the interpreter is not.
	t.Run("interpreter", func(t *testing.T) {
		root := t.TempDir()
		t.Setenv("PATH", "")
		t.Setenv(PythonEnvironment, "")
		writeYTDLPWheel(t, root, fixtureVersion)

		if _, err := FindYTDLP(root); err == nil {
			t.Fatal("FindYTDLP succeeded without an interpreter")
		} else if !strings.Contains(err.Error(), "Python") {
			t.Fatalf("error should name the missing interpreter, got %v", err)
		}
	})
	// The interpreter is present, yt-dlp is not.
	t.Run("wheel", func(t *testing.T) {
		root := t.TempDir()
		t.Setenv("PATH", "")
		t.Setenv(PythonEnvironment, "")
		writeBootstrapPython(t, root)

		if _, err := FindYTDLP(root); err == nil {
			t.Fatal("FindYTDLP succeeded without yt-dlp")
		} else if !strings.Contains(err.Error(), "yt-dlp") {
			t.Fatalf("error should name the missing tool, got %v", err)
		}
	})
}
