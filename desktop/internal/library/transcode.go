package library

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Ricori/nonoka-x/desktop/internal/managedtools"
)

type TranscodeResult struct {
	OK  bool   `json:"ok"`
	URL string `json:"url"`
}

// TranscodeToH264 creates a browser-compatible H.264/AAC cache copy for
// codecs such as HEVC, AV1, and 10-bit video that Chromium may not decode.
func (s *Service) TranscodeToH264(id string) (TranscodeResult, error) {
	if !validID(id) {
		return TranscodeResult{}, errors.New("无效的媒体 ID")
	}
	source, err := s.transcodeSource(id)
	if err != nil {
		return TranscodeResult{}, err
	}

	ctx, finish, ok := s.beginTranscode(id)
	if !ok {
		return TranscodeResult{}, errors.New("该视频正在转码")
	}
	defer finish()

	metadata, err := s.prober.Probe(ctx, source)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return TranscodeResult{}, errors.New("已取消")
		}
		return TranscodeResult{}, err
	}
	if !metadata.HasVideo {
		return TranscodeResult{}, errors.New("文件里没有视频轨")
	}
	ffmpeg, err := managedtools.Find(s.root, "ffmpeg")
	if err != nil {
		return TranscodeResult{}, errors.New("转码需要 FFmpeg，请先在设置中安装媒体工具")
	}

	destination := filepath.Join(s.cacheDirectory(), id+".mp4")
	if err := os.MkdirAll(s.cacheDirectory(), 0o755); err != nil {
		return TranscodeResult{}, err
	}
	part := destination + ".h264.part"
	_ = os.Remove(part)
	if err := s.runH264Transcode(ctx, ffmpeg, id, source, part, metadata.Duration); err != nil {
		_ = os.Remove(part)
		return TranscodeResult{}, err
	}
	if err := s.installTranscoded(id, part, destination); err != nil {
		_ = os.Remove(part)
		return TranscodeResult{}, err
	}

	url, err := s.MediaURL(id)
	if err != nil {
		return TranscodeResult{}, err
	}
	separator := "?"
	if strings.Contains(url, "?") {
		separator = "&"
	}
	s.emitChanged()
	return TranscodeResult{OK: true, URL: url + separator + "v=" + strconv.FormatInt(time.Now().UnixNano(), 10)}, nil
}

func (s *Service) CancelTranscode(id string) error {
	if !validID(id) {
		return errors.New("无效的媒体 ID")
	}
	s.mu.RLock()
	cancel := s.transcodeCancels[id]
	s.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (s *Service) beginTranscode(id string) (context.Context, func(), bool) {
	s.mu.Lock()
	if s.transcodeCancels == nil {
		s.transcodeCancels = make(map[string]context.CancelFunc)
	}
	if _, running := s.transcodeCancels[id]; running {
		s.mu.Unlock()
		return nil, nil, false
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.transcodeCancels[id] = cancel
	s.mu.Unlock()
	return ctx, func() {
		s.mu.Lock()
		delete(s.transcodeCancels, id)
		s.mu.Unlock()
		cancel()
	}, true
}

// Prefer the original file for quality; use the cache only when the original
// has moved or been deleted.
func (s *Service) transcodeSource(id string) (string, error) {
	entry, err := s.entryByID(id)
	if err != nil {
		return "", err
	}
	if fileExists(entry.SourcePath) {
		return entry.SourcePath, nil
	}
	if cached := s.cachedPath(id); cached != "" {
		return cached, nil
	}
	return "", errors.New("找不到本地视频文件，请重新定位")
}

func (s *Service) runH264Transcode(ctx context.Context, ffmpeg, id, input, output string, duration float64) error {
	command := exec.CommandContext(ctx, ffmpeg, buildTranscodeArgs(input, output)...)
	configureMediaCommand(command)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return errors.New("已取消")
		}
		return err
	}

	lastProgress := time.Time{}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		done, ok := parseTranscodeProgress(scanner.Text(), duration)
		if !ok || (done < duration && time.Since(lastProgress) < 150*time.Millisecond) {
			continue
		}
		lastProgress = time.Now()
		s.emitMediaProgress(MediaProgress{ID: id, Stage: "transcode", Done: done, Total: duration})
	}
	scanErr := scanner.Err()
	runErr := command.Wait()
	if errors.Is(ctx.Err(), context.Canceled) {
		return errors.New("已取消")
	}
	if runErr != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = runErr.Error()
		}
		return fmt.Errorf("转码失败：%s", message)
	}
	if scanErr != nil {
		return fmt.Errorf("读取转码进度失败：%w", scanErr)
	}
	s.emitMediaProgress(MediaProgress{ID: id, Stage: "transcode", Done: duration, Total: duration})
	return nil
}

func (s *Service) installTranscoded(id, part, destination string) error {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	entries, err := os.ReadDir(s.cacheDirectory())
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || cacheFileID(entry.Name()) != id || !isCacheFile(entry.Name()) {
			continue
		}
		if err := os.Remove(filepath.Join(s.cacheDirectory(), entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := os.Rename(part, destination); err != nil {
		return err
	}
	s.touchEntry(id)
	return s.convergeCacheLocked()
}

func parseTranscodeProgress(line string, duration float64) (float64, bool) {
	const prefix = "out_time_us="
	if duration <= 0 || !strings.HasPrefix(line, prefix) {
		return 0, false
	}
	microseconds, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(line, prefix)), 64)
	if err != nil || microseconds < 0 {
		return 0, false
	}
	return math.Min(microseconds/1e6, duration), true
}

func buildTranscodeArgs(input, output string) []string {
	return []string{
		"-v", "error", "-y", "-i", input,
		"-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
		"-f", "mp4", "-progress", "pipe:1", "-nostats", output,
	}
}
