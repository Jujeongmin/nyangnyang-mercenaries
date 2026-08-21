param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [ValidateSet('Navy','Brown','Gold','Gray','Wood')][string]$Field = 'Navy'
)

Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::FromFile($InputPath)
try {
    $flat = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        for ($y = 0; $y -lt $source.Height; $y++) {
            for ($x = 0; $x -lt $source.Width; $x++) {
                $c = $source.GetPixel($x, $y)
                $isField = if ($Field -eq 'Navy') {
                    $c.A -gt 0 -and $c.B -ge ($c.R + 10) -and $c.B -ge ($c.G + 4) -and $c.R -lt 70 -and $c.G -lt 85
                } elseif ($Field -eq 'Brown') {
                    $c.A -gt 0 -and $c.R -ge 32 -and $c.R -lt 90 -and $c.G -ge 24 -and $c.G -lt 75 -and $c.B -ge 24 -and $c.B -lt 80 -and [Math]::Abs($c.R - $c.B) -lt 30
                } elseif ($Field -eq 'Gold') {
                    $insideCenter = $x -gt ($source.Width * 0.10) -and $x -lt ($source.Width * 0.90) -and $y -gt ($source.Height * 0.24) -and $y -lt ($source.Height * 0.76)
                    $c.A -gt 0 -and $insideCenter -and $c.R -gt 180 -and $c.G -gt 95 -and $c.B -lt 110 -and $c.R -gt ($c.B + 100)
                } elseif ($Field -eq 'Gray') {
                    $insideCenter = $x -gt ($source.Width * 0.10) -and $x -lt ($source.Width * 0.90) -and $y -gt ($source.Height * 0.24) -and $y -lt ($source.Height * 0.76)
                    $c.A -gt 0 -and $insideCenter -and $c.R -ge 35 -and $c.R -lt 120 -and $c.G -ge 40 -and $c.G -lt 125 -and $c.B -ge 50 -and $c.B -lt 140 -and [Math]::Abs($c.R - $c.G) -lt 30 -and [Math]::Abs($c.G - $c.B) -lt 35
                } else {
                    $insideCenter = $x -gt ($source.Width * 0.08) -and $x -lt ($source.Width * 0.92) -and $y -gt ($source.Height * 0.25) -and $y -lt ($source.Height * 0.75)
                    $c.A -gt 0 -and $insideCenter -and $c.R -ge 40 -and $c.R -lt 155 -and $c.G -ge 22 -and $c.G -lt 100 -and $c.B -ge 12 -and $c.B -lt 75 -and $c.R -gt ($c.G + 15) -and $c.G -gt $c.B
                }
                if ($isField) {
                    $replacement = if ($Field -eq 'Navy') {
                        [System.Drawing.Color]::FromArgb($c.A, 16, 27, 50)
                    } elseif ($Field -eq 'Brown') {
                        [System.Drawing.Color]::FromArgb($c.A, 55, 42, 45)
                    } elseif ($Field -eq 'Gold') {
                        [System.Drawing.Color]::FromArgb($c.A, 244, 174, 32)
                    } elseif ($Field -eq 'Gray') {
                        [System.Drawing.Color]::FromArgb($c.A, 54, 63, 78)
                    } else {
                        [System.Drawing.Color]::FromArgb($c.A, 80, 46, 25)
                    }
                    $flat.SetPixel($x, $y, $replacement)
                } else {
                    $flat.SetPixel($x, $y, $c)
                }
            }
        }

        $canvas = New-Object System.Drawing.Bitmap(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $g = [System.Drawing.Graphics]::FromImage($canvas)
            try {
                $g.Clear([System.Drawing.Color]::Transparent)
                $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $scale = [Math]::Min(1024.0 / $flat.Width, 1024.0 / $flat.Height)
                $w = [int][Math]::Round($flat.Width * $scale)
                $h = [int][Math]::Round($flat.Height * $scale)
                $dx = [int][Math]::Floor((1024 - $w) / 2)
                $dy = [int][Math]::Floor((1024 - $h) / 2)
                $g.DrawImage($flat, $dx, $dy, $w, $h)
            } finally {
                $g.Dispose()
            }
            for ($i = 0; $i -lt 1024; $i++) {
                $canvas.SetPixel($i, 0, [System.Drawing.Color]::Transparent)
                $canvas.SetPixel($i, 1023, [System.Drawing.Color]::Transparent)
                $canvas.SetPixel(0, $i, [System.Drawing.Color]::Transparent)
                $canvas.SetPixel(1023, $i, [System.Drawing.Color]::Transparent)
            }
            $dir = Split-Path -Parent $OutputPath
            if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
            $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $canvas.Dispose()
        }
    } finally {
        $flat.Dispose()
    }
} finally {
    $source.Dispose()
}
