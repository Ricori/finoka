package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Ricori/finoka/desktop/internal/sidecar"
)

const (
	pythonEnvironment = "FINOKA_PYTHON"
	scriptEnvironment = "FINOKA_SIDECAR_SCRIPT"
	dataEnvironment   = "FINOKA_DATA_DIR"
	vendorEnvironment = "FINOKA_VENDOR_DIR"
)

// One probe of a candidate interpreter. Generous: a cold first run on a slow
// disk still finishes well inside it, and the probe only runs at startup.
const interpreterProbeTimeout = 10 * time.Second

// 3.12 exactly, not a floor: it is the one version the launcher environment is
// built and hash-pinned for (bootstrap-requirements.win-py312.txt), and the one
// the sidecar sources are tested on. Anything else — older or newer — hands over
// to the managed Python rather than running the sidecar untested.
const interpreterProbeScript = "import sys; sys.version_info[:2] == (3, 12) or sys.exit(1); import httpx, pydantic"

// SidecarConfig resolves development defaults without baking a checkout path
// into the application. Packaged builds set the same four environment values
// to their managed runtime and resource locations.
func SidecarConfig() (sidecar.Config, error) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return sidecar.Config{}, err
	}
	data, err := DataDirectory()
	if err != nil {
		return sidecar.Config{}, err
	}
	resourceRoot, resourceErr := ensureBundledResources(data)
	if resourceRoot == "" {
		resourceRoot = packagedResourceRoot()
	}
	python := os.Getenv(pythonEnvironment)
	if python == "" {
		pythonCandidates := append([]string{managedBootstrapPython(data)}, bundledPythonCandidates(resourceRoot)...)
		python = firstUsableExecutable(interpreterCanRunSidecar, pythonCandidates...)
	}
	if python == "" {
		// Refusing here is what surfaces the managed-Python offer: the desktop
		// shell only shows it while the sidecar is down.
		return sidecar.Config{}, errors.New("未找到可运行本地服务的 Python（需要 3.12 并带 httpx、pydantic）：将改用内置的 Python 3.12 启动环境")
	}
	scriptCandidates := []string{"scripts/run_local_sidecar.py", "../scripts/run_local_sidecar.py"}
	vendorCandidates := []string{"third_party/finesub", "../third_party/finesub"}
	if resourceRoot != "" {
		scriptCandidates = append([]string{filepath.Join(resourceRoot, "scripts", "run_local_sidecar.py")}, scriptCandidates...)
		vendorCandidates = append([]string{filepath.Join(resourceRoot, "third_party", "finesub")}, vendorCandidates...)
	}
	script := firstConfiguredPath(scriptEnvironment, workingDirectory, scriptCandidates...)
	vendor := firstConfiguredPath(vendorEnvironment, workingDirectory, vendorCandidates...)
	config, err := sidecar.PythonConfig(python, script, data, vendor)
	if err != nil {
		return sidecar.Config{}, err
	}
	return config, errors.Join(
		resourceErr,
		requirePath(config.Args[0], "sidecar script"),
		requirePath(config.Args[4], "FineSub vendor directory"),
	)
}

func managedBootstrapPython(dataDirectory string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(dataDirectory, "bootstrap", "launcher", "Scripts", "python.exe")
	}
	return filepath.Join(dataDirectory, "bootstrap", "launcher", "bin", "python3")
}

// packagedResourceRoot locates the Python source bundle staged beside a raw
// executable or inside a macOS application bundle. Environment overrides still
// take precedence so development and managed-runtime diagnostics stay simple.
func packagedResourceRoot() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	executableDirectory := filepath.Dir(executable)
	candidates := []string{filepath.Join(executableDirectory, "resources", "finoka")}
	if runtime.GOOS == "darwin" {
		candidates = append([]string{filepath.Join(executableDirectory, "..", "Resources", "finoka")}, candidates...)
	}
	for _, candidate := range candidates {
		resolved, resolveErr := filepath.Abs(candidate)
		if resolveErr == nil {
			if info, statErr := os.Stat(resolved); statErr == nil && info.IsDir() {
				return resolved
			}
		}
	}
	return ""
}

func bundledPythonCandidates(resourceRoot string) []string {
	if resourceRoot == "" {
		return nil
	}
	if runtime.GOOS == "windows" {
		return []string{
			filepath.Join(resourceRoot, "runtime", "python", "python.exe"),
			filepath.Join(resourceRoot, "runtime", "python.exe"),
		}
	}
	return []string{
		filepath.Join(resourceRoot, "runtime", "python", "bin", "python3"),
		filepath.Join(resourceRoot, "runtime", "bin", "python3"),
	}
}

// firstUsableExecutable returns the first interpreter that both exists and
// satisfies `usable`. An interpreter of the wrong version, or without FineSub's
// bootstrap dependencies, is worse than none: it starts a sidecar that answers
// every request but fails to build its provisioner, and the runtime page then
// shows permanently disabled buttons with the managed-Python offer hidden,
// because that offer is gated on the sidecar being down.
func firstUsableExecutable(usable func(string) bool, candidates ...string) string {
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err != nil || info.IsDir() {
			continue
		}
		if usable(candidate) {
			return candidate
		}
	}
	for _, name := range []string{"python3.12", "python3", "python"} {
		executable, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		if usable(executable) {
			return executable
		}
	}
	return ""
}

// interpreterCanRunSidecar extends the import check the Python bootstrap uses to
// accept its own freshly built launcher environment with the exact version the
// sidecar sources are built for. Failure is the answer for anything that cannot be run
// at all, so a stale path or a Store alias stub counts as unusable.
func interpreterCanRunSidecar(python string) bool {
	probeContext, cancel := context.WithTimeout(context.Background(), interpreterProbeTimeout)
	defer cancel()
	command := exec.CommandContext(probeContext, python, "-I", "-c", interpreterProbeScript)
	configureBootstrapProcess(command)
	return command.Run() == nil
}

func DataDirectory() (string, error) {
	if configured := os.Getenv(dataEnvironment); configured != "" {
		return filepath.Abs(configured)
	}
	return platformDataDirectory(runtime.GOOS, os.Getenv("APPDATA"), os.Getenv("HOME"))
}

func platformDataDirectory(goos, appData, home string) (string, error) {
	switch goos {
	case "windows":
		if strings.TrimSpace(appData) == "" {
			return "", errors.New("APPDATA is unavailable")
		}
		return filepath.Join(appData, "Finoka"), nil
	case "darwin":
		if strings.TrimSpace(home) == "" {
			return "", errors.New("HOME is unavailable")
		}
		return filepath.Join(home, "Library", "Application Support", "Finoka"), nil
	default:
		return "", fmt.Errorf("Finoka desktop does not support %s", goos)
	}
}

func firstConfiguredPath(environment, workingDirectory string, candidates ...string) string {
	if configured := os.Getenv(environment); configured != "" {
		return configured
	}
	for _, candidate := range candidates {
		resolved := candidate
		if !filepath.IsAbs(resolved) {
			resolved = filepath.Join(workingDirectory, resolved)
		}
		if _, err := os.Stat(resolved); err == nil {
			return resolved
		}
	}
	if filepath.IsAbs(candidates[0]) {
		return candidates[0]
	}
	return filepath.Join(workingDirectory, candidates[0])
}

func requirePath(path, description string) error {
	if _, err := os.Stat(path); err != nil {
		return errors.New(description + " is unavailable: " + err.Error())
	}
	return nil
}
