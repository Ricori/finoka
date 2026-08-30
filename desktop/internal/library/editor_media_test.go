package library

import (
	"context"
	"testing"
)

func TestParseExportProgress(t *testing.T) {
	done, ok := parseExportProgress("out_time_us=12500000", 20)
	if !ok || done != 12.5 {
		t.Fatalf("progress = %v, %v; want 12.5, true", done, ok)
	}
	done, ok = parseExportProgress("out_time_us=25000000", 20)
	if !ok || done != 20 {
		t.Fatalf("clamped progress = %v, %v; want 20, true", done, ok)
	}
}

func TestParseExportProgressRejectsOtherOutput(t *testing.T) {
	for _, line := range []string{"frame=12", "out_time_us=invalid", "out_time_us=-1"} {
		if _, ok := parseExportProgress(line, 20); ok {
			t.Fatalf("accepted invalid progress line %q", line)
		}
	}
}

func TestCancelExport(t *testing.T) {
	service := &Service{
		exportCancels: make(map[string]context.CancelFunc),
	}
	cancelled := false
	id := "loc_0123456789ab"
	service.exportCancels[id] = func() { cancelled = true }

	if err := service.CancelExport("invalid"); err == nil {
		t.Fatal("expected error for invalid id")
	}
	if err := service.CancelExport(id); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cancelled {
		t.Fatal("expected cancel func to be called")
	}
}
