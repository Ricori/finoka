package library

import "testing"

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
