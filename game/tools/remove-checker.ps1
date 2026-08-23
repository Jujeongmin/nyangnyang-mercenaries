param(
    [Parameter(Mandatory=$true)][string[]]$Path,
    [int]$SeedX = -1,
    [int]$SeedY = -1
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class CheckerBackground {
    public static void Remove(string path, int seedX, int seedY) {
        using (var src = new Bitmap(path))
        using (var rgba = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(rgba)) g.DrawImageUnscaled(src, 0, 0);
            int w = rgba.Width, h = rgba.Height;
            var seen = new bool[w * h];
            var queue = new Queue<int>();
            for (int x = 0; x < w; x++) { queue.Enqueue(x); queue.Enqueue((h - 1) * w + x); }
            for (int y = 1; y < h - 1; y++) { queue.Enqueue(y * w); queue.Enqueue(y * w + w - 1); }
            if (seedX >= 0 && seedX < w && seedY >= 0 && seedY < h)
                queue.Enqueue(seedY * w + seedX);
            while (queue.Count > 0) {
                int i = queue.Dequeue();
                if (seen[i]) continue;
                seen[i] = true;
                int x = i % w, y = i / w;
                Color c = rgba.GetPixel(x, y);
                int max = Math.Max(c.R, Math.Max(c.G, c.B));
                int min = Math.Min(c.R, Math.Min(c.G, c.B));
                if (max - min > 12 || min < 215) continue;
                rgba.SetPixel(x, y, Color.FromArgb(0, c.R, c.G, c.B));
                if (x > 0) queue.Enqueue(i - 1);
                if (x < w - 1) queue.Enqueue(i + 1);
                if (y > 0) queue.Enqueue(i - w);
                if (y < h - 1) queue.Enqueue(i + w);
            }
            string temp = path + ".cut.png";
            rgba.Save(temp, ImageFormat.Png);
            src.Dispose();
            System.IO.File.Delete(path);
            System.IO.File.Move(temp, path);
        }
    }
}
'@

foreach ($item in $Path) {
    [CheckerBackground]::Remove((Resolve-Path -LiteralPath $item).Path, $SeedX, $SeedY)
}
