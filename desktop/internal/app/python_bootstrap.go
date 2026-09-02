package app

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Ricori/nonoka-x/desktop/internal/managedtools"
	"github.com/Ricori/nonoka-x/desktop/internal/sidecar"
)

const (
	bootstrapPythonVersion       = "3.12"
	bootstrapUVURL               = "https://github.com/astral-sh/uv/releases/download/0.11.32/uv-x86_64-pc-windows-msvc.zip"
	bootstrapUVSize        int64 = 25726255
	bootstrapUVSHA256            = "acfde570451cfdb8689fa159a138ee805ba4e241c466432750302c86254b0984"
	bootstrapPyPIIndex           = "https://pypi.tuna.tsinghua.edu.cn/simple"
	bootstrapPythonMirror        = "https://ghproxy.net/https://github.com/astral-sh/python-build-standalone/releases/download"
)

var defaultGitHubMirrorPrefixes = []string{
	"https://ghproxy.net/",
	"https://gh-proxy.com/",
	"https://mirror.ghproxy.com/",
}

func gitHubDownloadURLs(rawURL string) []string {
	var urls []string
	if custom := strings.TrimSpace(os.Getenv("NONOKA_GITHUB_PROXY")); custom != "" {
		if !strings.HasSuffix(custom, "/") {
			custom += "/"
		}
		urls = append(urls, custom+rawURL)
	} else if customFine := strings.TrimSpace(os.Getenv("FINESUB_GITHUB_FILE_PROXY")); customFine != "" {
		if !strings.HasSuffix(customFine, "/") {
			customFine += "/"
		}
		urls = append(urls, customFine+rawURL)
	}

	urls = append(urls, rawURL)

	for _, prefix := range defaultGitHubMirrorPrefixes {
		mirrorURL := prefix + rawURL
		if !containsString(urls, mirrorURL) {
			urls = append(urls, mirrorURL)
		}
	}
	return urls
}

func containsString(slice []string, target string) bool {
	for _, item := range slice {
		if item == target {
			return true
		}
	}
	return false
}

type bootstrapProgress struct {
	Completed      int64   `json:"completed"`
	Total          int64   `json:"total"`
	Unit           string  `json:"unit"`
	BytesPerSecond float64 `json:"bytes_per_second,omitempty"`
}

type pythonBootstrapState struct {
	Schema    int                `json:"schema"`
	Platform  string             `json:"platform"`
	Supported bool               `json:"supported"`
	State     string             `json:"state"`
	Stage     string             `json:"stage"`
	Message   string             `json:"message"`
	Progress  *bootstrapProgress `json:"progress"`
	Python    string             `json:"python,omitempty"`
}

// PythonBootstrap installs only the small launcher environment needed to run
// the sidecar. The sidecar remains responsible for the much larger AI runtime.
// Keeping this bootstrap in Go avoids requiring Python in order to install
// Python on a fresh machine.
type PythonBootstrap struct {
	mu           sync.RWMutex
	state        pythonBootstrapState
	dataDir      string
	requirements string
	manager      *sidecar.Manager
	client       *http.Client
}

func NewPythonBootstrap(dataDirectory string, manager *sidecar.Manager) *PythonBootstrap {
	state := pythonBootstrapState{
		Schema:    1,
		Platform:  runtime.GOOS + "-" + runtime.GOARCH,
		Supported: runtime.GOOS == "windows" && runtime.GOARCH == "amd64",
		State:     "missing",
		Stage:     "waiting",
		Message:   "需要下载 Python 以启用本地服务",
	}
	python := managedtools.BootstrapPython(dataDirectory)
	if info, err := os.Stat(python); err == nil && !info.IsDir() {
		state.State = "ready"
		state.Stage = "completed"
		state.Message = "Python 启动环境已安装"
		state.Python = python
	}
	if !state.Supported {
		state.Message = "自动安装 Python 当前仅支持 Windows x64"
	}
	return &PythonBootstrap{
		state:        state,
		dataDir:      dataDirectory,
		requirements: bootstrapRequirementsPath(dataDirectory),
		manager:      manager,
		client:       &http.Client{Timeout: 30 * time.Minute},
	}
}

func bootstrapRequirementsPath(dataDirectory string) string {
	if resourceRoot, _ := ensureBundledResources(dataDirectory); resourceRoot != "" {
		candidate := filepath.Join(resourceRoot, "bootstrap-requirements.win-py312.txt")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	workingDirectory, _ := os.Getwd()
	for _, candidate := range []string{
		filepath.Join(workingDirectory, "..", "bootstrap-requirements.win-py312.txt"),
		filepath.Join(workingDirectory, "bootstrap-requirements.win-py312.txt"),
	} {
		if resolved, err := filepath.Abs(candidate); err == nil {
			if _, statErr := os.Stat(resolved); statErr == nil {
				return resolved
			}
		}
	}
	return filepath.Join(workingDirectory, "..", "bootstrap-requirements.win-py312.txt")
}

func (b *PythonBootstrap) Status() map[string]any {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.stateMapLocked()
}

func (b *PythonBootstrap) Install() (map[string]any, error) {
	b.mu.Lock()
	if !b.state.Supported {
		result := b.stateMapLocked()
		b.mu.Unlock()
		return result, errors.New("Python 自动安装当前仅支持 Windows x64")
	}
	if b.state.State == "running" {
		result := b.stateMapLocked()
		b.mu.Unlock()
		return result, nil
	}
	b.state.State = "running"
	b.state.Stage = "preparing"
	b.state.Message = "正在准备 Python 下载"
	b.state.Progress = nil
	result := b.stateMapLocked()
	b.mu.Unlock()
	go b.install()
	return result, nil
}

func (b *PythonBootstrap) stateMapLocked() map[string]any {
	result := map[string]any{
		"schema": b.state.Schema, "platform": b.state.Platform,
		"supported": b.state.Supported, "state": b.state.State,
		"stage": b.state.Stage, "message": b.state.Message,
		"progress": nil, "python": b.state.Python,
	}
	if b.state.Progress != nil {
		result["progress"] = map[string]any{
			"completed":        b.state.Progress.Completed,
			"total":            b.state.Progress.Total,
			"unit":             b.state.Progress.Unit,
			"bytes_per_second": b.state.Progress.BytesPerSecond,
		}
	}
	return result
}

func (b *PythonBootstrap) update(stage, message string, progress *bootstrapProgress) {
	b.mu.Lock()
	b.state.Stage = stage
	b.state.Message = message
	b.state.Progress = progress
	b.mu.Unlock()
}

func (b *PythonBootstrap) fail(err error) {
	b.mu.Lock()
	b.state.State = "failed"
	b.state.Stage = "failed"
	b.state.Message = err.Error()
	b.state.Progress = nil
	b.mu.Unlock()
}

func (b *PythonBootstrap) install() {
	python := managedtools.BootstrapPython(b.dataDir)
	if info, err := os.Stat(python); err != nil || info.IsDir() {
		if err := b.installPython(); err != nil {
			b.fail(err)
			return
		}
	}
	b.update("activating", "正在启动本地服务", nil)
	config, err := SidecarConfig()
	if err == nil {
		err = b.manager.Configure(config)
		// A sidecar already running on a system interpreter cannot build its
		// provisioner, and the managed Python only takes effect once that
		// process is swapped for one started from it.
		if errors.Is(err, sidecar.ErrAlreadyRunning) && b.manager.Executable() != config.Executable {
			stopContext, cancelStop := context.WithTimeout(context.Background(), lifecycleTimeout)
			err = b.manager.Stop(stopContext)
			cancelStop()
			if err == nil {
				err = b.manager.Configure(config)
			}
		}
	}
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), lifecycleTimeout)
		_, err = b.manager.Start(ctx)
		cancel()
	}
	if err != nil && !errors.Is(err, sidecar.ErrAlreadyRunning) {
		b.fail(fmt.Errorf("Python 已安装，但本地服务启动失败：%w", err))
		return
	}
	b.mu.Lock()
	b.state.State = "ready"
	b.state.Stage = "completed"
	b.state.Message = "Python 已安装，本地服务已启用"
	b.state.Progress = nil
	b.state.Python = python
	b.mu.Unlock()
}

func (b *PythonBootstrap) installPython() error {
	root := filepath.Join(b.dataDir, "bootstrap")
	downloads := filepath.Join(root, "downloads")
	tools := filepath.Join(root, "tools")
	launcher := filepath.Join(root, "launcher")
	staging := launcher + ".staging"
	if err := os.MkdirAll(downloads, 0o700); err != nil {
		return fmt.Errorf("创建 Python 下载目录失败：%w", err)
	}
	uvArchive := filepath.Join(downloads, "uv-0.11.32-windows-x64.zip")
	if !fileMatches(uvArchive, bootstrapUVSize, bootstrapUVSHA256) {
		candidateURLs := gitHubDownloadURLs(bootstrapUVURL)
		if err := b.downloadWithFallback(candidateURLs, uvArchive, bootstrapUVSize, bootstrapUVSHA256); err != nil {
			return err
		}
	}
	b.update("extracting", "正在解压 Python 安装器", nil)
	if err := os.RemoveAll(tools); err != nil {
		return err
	}
	if err := extractNamedZipFile(uvArchive, "uv.exe", filepath.Join(tools, "uv.exe")); err != nil {
		return fmt.Errorf("解压 Python 安装器失败：%w", err)
	}
	if err := os.RemoveAll(staging); err != nil {
		return err
	}
	uv := filepath.Join(tools, "uv.exe")
	environment := append(os.Environ(),
		"UV_CACHE_DIR="+filepath.Join(root, "cache"),
		"UV_PYTHON_INSTALL_DIR="+filepath.Join(root, "python-installations"),
		"UV_NO_PROGRESS=1",
	)
	if os.Getenv("UV_PYTHON_INSTALL_MIRROR") == "" {
		environment = append(environment, "UV_PYTHON_INSTALL_MIRROR="+bootstrapPythonMirror)
	}
	if os.Getenv("UV_DEFAULT_INDEX") == "" && os.Getenv("UV_INDEX_URL") == "" && os.Getenv("PIP_INDEX_URL") == "" {
		environment = append(environment, "UV_DEFAULT_INDEX="+bootstrapPyPIIndex)
	}

	b.update("installing_python", "正在下载并安装 Python "+bootstrapPythonVersion, nil)
	if output, err := runBootstrapCommand(uv, environment, "venv", staging, "--python", bootstrapPythonVersion, "--managed-python", "--no-project"); err != nil {
		// If mirror failed, retry once with standard environment without mirror variable
		if os.Getenv("UV_PYTHON_INSTALL_MIRROR") == "" {
			_ = os.RemoveAll(staging)
			cleanEnv := make([]string, 0, len(environment))
			for _, envItem := range environment {
				if !strings.HasPrefix(envItem, "UV_PYTHON_INSTALL_MIRROR=") {
					cleanEnv = append(cleanEnv, envItem)
				}
			}
			if retryOutput, retryErr := runBootstrapCommand(uv, cleanEnv, "venv", staging, "--python", bootstrapPythonVersion, "--managed-python", "--no-project"); retryErr == nil {
				output = retryOutput
				err = nil
			}
		}
		if err != nil {
			return fmt.Errorf("安装 Python 失败：%w%s", err, commandDetail(output))
		}
	}
	stagingPython := filepath.Join(staging, "Scripts", "python.exe")
	b.update("installing_dependencies", "正在安装本地服务基础依赖", nil)
	if output, err := runBootstrapCommand(uv, environment, "pip", "install", "--python", stagingPython, "--require-hashes", "-r", b.requirements); err != nil {
		// If custom index failed, retry once with standard index
		if os.Getenv("UV_DEFAULT_INDEX") == "" {
			cleanEnv := make([]string, 0, len(environment))
			for _, envItem := range environment {
				if !strings.HasPrefix(envItem, "UV_DEFAULT_INDEX=") {
					cleanEnv = append(cleanEnv, envItem)
				}
			}
			if retryOutput, retryErr := runBootstrapCommand(uv, cleanEnv, "pip", "install", "--python", stagingPython, "--require-hashes", "-r", b.requirements); retryErr == nil {
				output = retryOutput
				err = nil
			}
		}
		if err != nil {
			return fmt.Errorf("安装 Python 基础依赖失败：%w%s", err, commandDetail(output))
		}
	}
	if output, err := runBootstrapCommand(stagingPython, environment, "-I", "-c", "import httpx, pydantic"); err != nil {
		return fmt.Errorf("验证 Python 启动环境失败：%w%s", err, commandDetail(output))
	}
	if err := os.RemoveAll(launcher); err != nil {
		return err
	}
	if err := os.Rename(staging, launcher); err != nil {
		return fmt.Errorf("启用 Python 启动环境失败：%w", err)
	}
	return nil
}

func (b *PythonBootstrap) downloadWithFallback(candidateURLs []string, destination string, size int64, digest string) error {
	var attempts []string

	for i, candidateURL := range candidateURLs {
		sourceLabel := "官方源"
		if i > 0 {
			sourceLabel = "加速镜像"
			if parsed, err := url.Parse(candidateURL); err == nil && parsed.Host != "" {
				sourceLabel = parsed.Host
			}
		}

		progressMsg := "正在下载 Python 安装器"
		if i > 0 {
			progressMsg = fmt.Sprintf("官方下载失败，正在切换至加速镜像 (%s)", sourceLabel)
		}
		b.update("downloading", progressMsg, &bootstrapProgress{Total: size, Unit: "bytes"})

		err := b.downloadSingle(candidateURL, destination, size, digest)
		if err == nil {
			return nil
		}

		attempts = append(attempts, fmt.Sprintf("[%s]: %v", sourceLabel, err))
		time.Sleep(500 * time.Millisecond)
	}

	primaryMirror := defaultGitHubMirrorPrefixes[0] + bootstrapUVURL
	return fmt.Errorf("下载 Python 安装器失败（已尝试官方及所有加速镜像）。\n"+
		"您可以手动下载该文件并放入指定目录后重试：\n"+
		"• 官方下载链接：%s\n"+
		"• 镜像加速链接：%s\n"+
		"• 目标放置路径：%s\n"+
		"• 详细错误日志：%s",
		bootstrapUVURL, primaryMirror, destination, strings.Join(attempts, "；"))
}

func (b *PythonBootstrap) downloadSingle(urlStr, destination string, size int64, digest string) error {
	partial := destination + ".part"
	_ = os.Remove(partial)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "nonoka-sub-x-bootstrap")

	response, err := b.client.Do(request)
	if err != nil {
		return fmt.Errorf("网络请求失败：%w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP 响应码 %d", response.StatusCode)
	}

	output, err := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}

	started := time.Now()
	buffer := make([]byte, 128<<10)
	var completed int64
	for {
		count, readErr := response.Body.Read(buffer)
		if count > 0 {
			if _, err = output.Write(buffer[:count]); err != nil {
				output.Close()
				_ = os.Remove(partial)
				return err
			}
			completed += int64(count)
			seconds := time.Since(started).Seconds()
			b.update("downloading", "正在下载 Python 安装器", &bootstrapProgress{
				Completed: completed, Total: size, Unit: "bytes", BytesPerSecond: float64(completed) / max(seconds, 0.001),
			})
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			output.Close()
			_ = os.Remove(partial)
			return readErr
		}
	}
	if err := output.Close(); err != nil {
		_ = os.Remove(partial)
		return err
	}

	b.update("verifying", "正在校验 Python 安装器", nil)
	if !fileMatches(partial, size, digest) {
		_ = os.Remove(partial)
		return errors.New("Python 安装器大小或 SHA-256 校验失败")
	}

	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = os.Remove(partial)
		return err
	}
	if err := os.Rename(partial, destination); err != nil {
		_ = os.Remove(partial)
		return err
	}
	return nil
}

func fileMatches(path string, size int64, expectedDigest string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() != size {
		return false
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return false
	}
	return hex.EncodeToString(hash.Sum(nil)) == expectedDigest
}

func extractNamedZipFile(archive, name, destination string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if filepath.Base(filepath.FromSlash(entry.Name)) != name || entry.FileInfo().IsDir() {
			continue
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			input.Close()
			return err
		}
		output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := errors.Join(input.Close(), output.Close())
		return errors.Join(copyErr, closeErr)
	}
	return fmt.Errorf("%s 不在下载的压缩包中", name)
}

func runBootstrapCommand(executable string, environment []string, arguments ...string) ([]byte, error) {
	command := exec.Command(executable, arguments...)
	command.Env = environment
	configureBootstrapProcess(command)
	return command.CombinedOutput()
}

func commandDetail(output []byte) string {
	detail := strings.TrimSpace(string(output))
	if len(detail) > 2000 {
		detail = detail[len(detail)-2000:]
	}
	if detail == "" {
		return ""
	}
	return "：" + detail
}
