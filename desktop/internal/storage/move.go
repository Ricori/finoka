package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// partialSuffix names the marker written beside a destination while it is being
// filled. A cross-drive relocation cannot be atomic, and the record in
// storage.json — not the presence of the directory — is what commits it. So the
// destination is written in place and this marker is what tells a later run
// that the tree is Finoka's own unfinished copy: safe to resume, and never to
// be mistaken for a finished install or for the user's own data.
const partialSuffix = ".finoka-partial"

const copyBufferSize = 1 << 20

// A directory rename fails on Windows while anything inside it still has an
// open handle, and a virus scanner holds handles on freshly written executables
// for a few seconds. That is a wait, not a failure: several gigabytes have
// already been copied by the time it happens.
const (
	renameAttempts = 8
	renameBackoff  = 250 * time.Millisecond
)

// Usage describes one directory for the settings page.
type Usage struct {
	Bytes int64
	Files int
}

// partialRecord is the marker's content. Source is checked on resume so a
// marker left by a relocation of the video cache can never be used to adopt a
// half-copied runtime.
type partialRecord struct {
	Schema    int    `json:"schema"`
	Source    string `json:"source"`
	StartedAt int64  `json:"startedAt"`
}

func partialMarker(destination string) string { return destination + partialSuffix }

// Measure totals a directory. Unreadable entries are skipped rather than
// failing the walk: the number is a progress denominator and a size to show,
// not an audit.
func Measure(directory string) Usage {
	usage := Usage{}
	_ = filepath.WalkDir(directory, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return nil
		}
		usage.Bytes += info.Size()
		usage.Files++
		return nil
	})
	return usage
}

// ResumableCopy reports an unfinished copy of source sitting at destination,
// and how much of it is already there. A relocation that was cancelled, or that
// failed after an hour of copying, is worth continuing rather than repeating.
func ResumableCopy(source, destination string) (Usage, bool) {
	record, ok := readPartial(destination)
	if !ok || !sameLocation(record.Source, source) {
		return Usage{}, false
	}
	return Measure(destination), true
}

func readPartial(destination string) (partialRecord, bool) {
	data, err := os.ReadFile(partialMarker(destination))
	if err != nil {
		return partialRecord{}, false
	}
	var record partialRecord
	if json.Unmarshal(data, &record) != nil || record.Source == "" {
		return partialRecord{}, false
	}
	return record, true
}

func writePartial(source, destination string) error {
	data, err := json.Marshal(partialRecord{Schema: 1, Source: source, StartedAt: time.Now().Unix()})
	if err != nil {
		return err
	}
	return os.WriteFile(partialMarker(destination), data, 0o600)
}

// DiscardPartialCopy removes an unfinished copy and its marker. Only a copy of
// source is touched, so a marker that describes some other relocation is left
// for whoever owns it.
func DiscardPartialCopy(source, destination string) error {
	if _, resumable := ResumableCopy(source, destination); !resumable {
		return nil
	}
	if err := os.RemoveAll(destination); err != nil {
		return err
	}
	return os.Remove(partialMarker(destination))
}

// Move relocates source to destination, calling report with the bytes in place
// so far. A move within one volume is a rename and reports its total in one
// step; a move across volumes is a copy that can be resumed, and only deletes
// the source once every byte is in place.
//
// Nothing is deleted on failure or cancellation: the partial copy stays with
// its marker so the next attempt continues from where this one stopped, and the
// source stays untouched until the destination is complete.
func Move(ctx context.Context, source, destination string, total int64, report func(copied int64)) error {
	// Checked up front so a cancellation that arrives before the first byte is
	// honoured even when the move would have been an instant rename.
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		if os.IsNotExist(err) {
			// Nothing installed yet. Recording the new location is still the
			// right outcome, so the destination is created and the move is done.
			return os.MkdirAll(destination, 0o755)
		}
		return err
	}
	if !info.IsDir() {
		return errors.New("source is not a directory")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	// A resumable copy rules out the rename: the destination already holds part
	// of the tree, and renaming onto it would fail anyway.
	//
	// Any rename failure falls through to the copy — a cross-volume move is
	// reported as one, and there is no failure the copy cannot describe better
	// by hitting it itself.
	if _, resuming := ResumableCopy(source, destination); !resuming && tryRename(source, destination) {
		if report != nil {
			report(total)
		}
		return nil
	}
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	if err := writePartial(source, destination); err != nil {
		return err
	}
	if err := copyTree(ctx, source, destination, report); err != nil {
		// Deliberately kept: this is where hours of copying live, and the
		// marker is what lets the next attempt adopt it.
		return err
	}
	if err := os.Remove(partialMarker(destination)); err != nil {
		return err
	}
	if err := removeWithRetry(source); err != nil {
		// The destination is complete and the record will point at it, so this
		// is leftovers rather than a failure. The caller says so instead of
		// undoing a move that already succeeded.
		return fmt.Errorf("%w: %s", errSourceRemains, source)
	}
	return nil
}

// errSourceRemains marks the one failure that leaves a usable result.
var errSourceRemains = errors.New("旧目录未能删除，可稍后手动清理")

// SourceRemains reports whether a Move finished but could not clear the old
// directory — a file still held open by an antivirus scan is the usual reason.
func SourceRemains(err error) bool { return errors.Is(err, errSourceRemains) }

// tryRename attempts the same-volume fast path, waiting out the transient
// sharing violations a scanner causes. It reports only whether the rename
// happened: the cross-volume refusal that sends Move down its copy path is the
// expected answer here, not a failure worth propagating.
func tryRename(source, destination string) bool {
	// ValidateDestination allows an existing empty directory; rename does not.
	if entries, readErr := os.ReadDir(destination); readErr == nil {
		if len(entries) > 0 {
			return false
		}
		if removeErr := os.Remove(destination); removeErr != nil {
			return false
		}
	}
	for attempt := range renameAttempts {
		err := os.Rename(source, destination)
		if err == nil {
			return true
		}
		// A cross-volume rename never becomes possible by waiting.
		if !retryableFileError(err) {
			return false
		}
		time.Sleep(time.Duration(attempt+1) * renameBackoff)
	}
	return false
}

// removeWithRetry clears the old tree once the new one is complete, waiting out
// the same scanner handles that block a rename.
func removeWithRetry(directory string) error {
	var err error
	for attempt := range renameAttempts {
		if err = os.RemoveAll(directory); err == nil {
			return nil
		}
		if !retryableFileError(err) {
			return err
		}
		time.Sleep(time.Duration(attempt+1) * renameBackoff)
	}
	return err
}

func copyTree(ctx context.Context, source, destination string, report func(copied int64)) error {
	copied := int64(0)
	buffer := make([]byte, copyBufferSize)
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		relative, relErr := filepath.Rel(source, path)
		if relErr != nil {
			return relErr
		}
		target := filepath.Join(destination, relative)
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		switch {
		case entry.IsDir():
			return os.MkdirAll(target, permissionsOf(info, 0o755))
		case info.Mode()&os.ModeSymlink != 0:
			// Recreating the link keeps a relative link inside the tree
			// pointing at the copy rather than back at the source. Windows
			// refuses without developer mode or elevation, so an unprivileged
			// run falls back to copying what the link resolves to.
			if link, linkErr := os.Readlink(path); linkErr == nil {
				if os.Symlink(link, target) == nil {
					return nil
				}
			}
			written, copyErr := copyFile(ctx, path, target, 0o644, buffer)
			copied += written
			if report != nil {
				report(copied)
			}
			return copyErr
		case !info.Mode().IsRegular():
			// Devices, sockets and named pipes have no meaning in a copy of a
			// runtime tree, and nothing Finoka installs creates one.
			return nil
		default:
			// Already carried over by an earlier attempt. Files are written
			// whole or removed, so a matching size means matching contents.
			if existing, statErr := os.Stat(target); statErr == nil && existing.Size() == info.Size() {
				copied += info.Size()
				if report != nil {
					report(copied)
				}
				return nil
			}
			written, copyErr := copyFile(ctx, path, target, permissionsOf(info, 0o644), buffer)
			copied += written
			if report != nil {
				report(copied)
			}
			return copyErr
		}
	})
}

// permissionsOf keeps the executable bit that FFmpeg and the managed
// interpreters need on macOS. Windows reports 0666/0777 for everything, which
// the fallback matches closely enough.
func permissionsOf(info fs.FileInfo, fallback fs.FileMode) fs.FileMode {
	mode := info.Mode().Perm()
	if mode == 0 {
		return fallback
	}
	return mode
}

func copyFile(ctx context.Context, source, destination string, mode fs.FileMode, buffer []byte) (int64, error) {
	input, err := os.Open(source)
	if err != nil {
		return 0, err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return 0, err
	}
	copied := int64(0)
	for {
		if ctxErr := ctx.Err(); ctxErr != nil {
			output.Close()
			// Removed rather than left short: a resumed copy trusts a matching
			// size, so a truncated file must not survive to be trusted.
			_ = os.Remove(destination)
			return copied, ctxErr
		}
		read, readErr := input.Read(buffer)
		if read > 0 {
			written, writeErr := output.Write(buffer[:read])
			copied += int64(written)
			if writeErr != nil {
				output.Close()
				_ = os.Remove(destination)
				return copied, writeErr
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			output.Close()
			_ = os.Remove(destination)
			return copied, readErr
		}
	}
	if err := output.Close(); err != nil {
		_ = os.Remove(destination)
		return copied, err
	}
	return copied, nil
}
