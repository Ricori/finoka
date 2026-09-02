// Command icon validates and renders the Nonoka X application icon source.
package main

import (
	"flag"
	"fmt"
	"image/png"
	"os"
)

func main() {
	input := flag.String("input", "build/icon-source.png", "PNG source path")
	output := flag.String("output", "frontend/public/assets/icon.png", "PNG output path")
	flag.Parse()

	source, err := os.Open(*input)
	if err != nil {
		panic(err)
	}
	icon, err := png.Decode(source)
	closeErr := source.Close()
	if err != nil {
		panic(err)
	}
	if closeErr != nil {
		panic(closeErr)
	}
	if bounds := icon.Bounds(); bounds.Dx() != 1024 || bounds.Dy() != 1024 {
		panic(fmt.Errorf("icon source must be 1024x1024, got %dx%d", bounds.Dx(), bounds.Dy()))
	}

	file, err := os.Create(*output)
	if err != nil {
		panic(err)
	}
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(file, icon); err != nil {
		_ = file.Close()
		panic(err)
	}
	if err := file.Close(); err != nil {
		panic(err)
	}
}
