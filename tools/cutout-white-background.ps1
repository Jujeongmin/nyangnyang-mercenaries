param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [int]$Size=1024,
  [string]$ExtraSeeds=''
)
Add-Type -AssemblyName System.Drawing
$src=[System.Drawing.Bitmap]::new($InputPath);$w=$src.Width;$h=$src.Height
$seen=New-Object 'bool[]' ($w*$h);$q=New-Object 'System.Collections.Generic.Queue[int]'
function AddBg([int]$x,[int]$y){$i=$y*$w+$x;if($seen[$i]){return};$c=$src.GetPixel($x,$y);$min=[Math]::Min($c.R,[Math]::Min($c.G,$c.B));$max=[Math]::Max($c.R,[Math]::Max($c.G,$c.B));if($c.A-le 8-or($min-ge 220-and($max-$min)-le 32)){$seen[$i]=$true;$q.Enqueue($i)}}
for($x=0;$x-lt$w;$x++){AddBg $x 0;AddBg $x ($h-1)};for($y=0;$y-lt$h;$y++){AddBg 0 $y;AddBg ($w-1) $y}
if($ExtraSeeds){
  foreach($seed in ($ExtraSeeds -split ';')){
    $parts=$seed -split ','
    if($parts.Count -eq 2){
      $sx=[int]$parts[0];$sy=[int]$parts[1]
      if($sx-ge 0-and$sx-lt$w-and$sy-ge 0-and$sy-lt$h){AddBg $sx $sy}
    }
  }
}
while($q.Count){$i=$q.Dequeue();$x=$i%$w;$y=[Math]::Floor($i/$w);if($x-gt 0){AddBg ($x-1) $y};if($x+1-lt$w){AddBg ($x+1) $y};if($y-gt 0){AddBg $x ($y-1)};if($y+1-lt$h){AddBg $x ($y+1)}}
$cut=[System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for($y=0;$y-lt$h;$y++){for($x=0;$x-lt$w;$x++){$c=$src.GetPixel($x,$y);if($seen[$y*$w+$x]-or$c.A-le 8){$cut.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,$c.R,$c.G,$c.B))}else{$cut.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$c.R,$c.G,$c.B))}}}
$dst=[System.Drawing.Bitmap]::new($Size,$Size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb);$g=[System.Drawing.Graphics]::FromImage($dst);$g.CompositingMode=[System.Drawing.Drawing2D.CompositingMode]::SourceCopy;$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g.DrawImage($cut,0,0,$Size,$Size);$g.Dispose();$dst.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png);$dst.Dispose();$cut.Dispose();$src.Dispose()
