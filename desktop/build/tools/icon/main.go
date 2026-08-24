// Command icon renders the deterministic Finoka application icon.
package main

import (
	"flag"
	"image"
	"image/color"
	"image/png"
	"os"
)

func main() {
	output := flag.String("output", "frontend/public/assets/icon.png", "PNG output path")
	flag.Parse()
	const size = 1024
	canvas := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if rounded(x, y, size, 228) {
				t := float64(x+y) / float64(2*(size-1))
				canvas.SetRGBA(x, y, blend(color.RGBA{18, 40, 61, 255}, color.RGBA{7, 16, 26, 255}, t))
			}
		}
	}
	paintGradientRect(canvas, image.Rect(292, 184, 444, 760))
	paintGradientRect(canvas, image.Rect(372, 184, 732, 312))
	paintGradientRect(canvas, image.Rect(372, 450, 688, 574))
	paintCircle(canvas, 730, 735, 76, color.RGBA{101, 221, 179, 255})

	file, err := os.Create(*output)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	if err := png.Encode(file, canvas); err != nil {
		panic(err)
	}
}

func rounded(x, y, size, radius int) bool {
	if x >= radius && x < size-radius || y >= radius && y < size-radius {
		return true
	}
	cx, cy := radius, radius
	if x >= size-radius {
		cx = size - radius - 1
	}
	if y >= size-radius {
		cy = size - radius - 1
	}
	dx, dy := x-cx, y-cy
	return dx*dx+dy*dy <= radius*radius
}

func paintGradientRect(canvas *image.RGBA, rectangle image.Rectangle) {
	for y := rectangle.Min.Y; y < rectangle.Max.Y; y++ {
		for x := rectangle.Min.X; x < rectangle.Max.X; x++ {
			t := float64((x-292)+(y-184)) / 1016
			canvas.SetRGBA(x, y, blend(color.RGBA{142, 211, 255, 255}, color.RGBA{77, 130, 255, 255}, t))
		}
	}
}

func paintCircle(canvas *image.RGBA, cx, cy, radius int, value color.RGBA) {
	for y := cy - radius; y <= cy+radius; y++ {
		for x := cx - radius; x <= cx+radius; x++ {
			dx, dy := x-cx, y-cy
			if dx*dx+dy*dy <= radius*radius {
				canvas.SetRGBA(x, y, value)
			}
		}
	}
}

func blend(start, end color.RGBA, amount float64) color.RGBA {
	if amount < 0 {
		amount = 0
	}
	if amount > 1 {
		amount = 1
	}
	channel := func(a, b uint8) uint8 { return uint8(float64(a) + (float64(b)-float64(a))*amount) }
	return color.RGBA{channel(start.R, end.R), channel(start.G, end.G), channel(start.B, end.B), 255}
}
