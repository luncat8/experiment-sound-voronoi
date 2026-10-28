## canvas

on input N points rebuild voronoi diagram
point: mass ~ gravity

## gravity

voronoi cell - gravity area of point

user drag to launch probe - fly by gravity forces

## synth sound

2 modes radio buttons:
	- continue sound, volume depends on distance to point. freq depends of point id: (place points in such rule that all adjacent points are musical, i.e. pentatonic, but not same repetition across whole canvas. color cells according tone to visualize)
	- tone freq depends on distance to point, volume envelope freq (modulation) depends on distance (0.1 ... 30hz , sine).

use direction LR to points from probe

use only nearest (voronoi) center point and adjacent cells to generate sound. slider to adjust distance vs volume or vs freq according to mode
