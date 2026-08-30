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
// unpacked package directory plus the version pointer beside it.
func writeYTDLPWheel(t *testing.T, root, version string) string {
	t.Helper()
	resource := filepath.Join(root, "finesub", "runtime", "yt-dlp")
	entrypoint := filepath.Join(resource, version, "yt_dlp", "__main__.py")
	if err := os.MkdirAll(filepath.Dir(entrypoint), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entrypoint, []byte("# fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	pointer := filepath.Join(resource, "current.json")
	if err := os.WriteFile(pointer, []byte(`{"current":"`+version+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return entrypoint
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

// A wheel with no executable resolves to the managed interpreter running the
// package's own __main__.py -- the case that was silently broken.
func TestFindYTDLPRunsWheelThroughManagedPython(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", "")
	t.Setenv(PythonEnvironment, "")
	entrypoint := writeYTDLPWheel(t, root, fixtureVersion)
	python := writeBootstrapPython(t, root)

	executable, prefix, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if executable != python {
		t.Fatalf("executable = %q, want the managed interpreter %q", executable, python)
	}
	if want := []string{"-s", entrypoint}; !slices.Equal(prefix, want) {
		t.Fatalf("prefix = %q, want %q", prefix, want)
	}
}

// A real binary still wins, so swapping the resource back to a standalone
// build keeps working without touching this package.
func TestFindYTDLPPrefersNativeExecutable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", "")
	t.Setenv(PythonEnvironment, "")
	writeYTDLPWheel(t, root, fixtureVersion)
	writeBootstrapPython(t, root)
	filename := "yt-dlp"
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	native := filepath.Join(root, "finesub", "runtime", "yt-dlp", fixtureVersion, filename)
	if err := os.WriteFile(native, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}

	executable, prefix, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if executable != native {
		t.Fatalf("executable = %q, want the native binary %q", executable, native)
	}
	if len(prefix) != 0 {
		t.Fatalf("a native binary needs no interpreter prefix, got %q", prefix)
	}
}

// An explicit FINOKA_PYTHON outranks the bundled interpreter, which is what
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

	executable, _, err := FindYTDLP(root)
	if err != nil {
		t.Fatalf("FindYTDLP returned %v", err)
	}
	if executable != override {
		t.Fatalf("executable = %q, want the %s override %q", executable, PythonEnvironment, override)
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

		if _, _, err := FindYTDLP(root); err == nil {
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

		if _, _, err := FindYTDLP(root); err == nil {
			t.Fatal("FindYTDLP succeeded without yt-dlp")
		} else if !strings.Contains(err.Error(), "yt-dlp") {
			t.Fatalf("error should name the missing tool, got %v", err)
		}
	})
}