$in  = "src\data\tcgplayer_skus.json"
$out = "src\data\tcgplayer_skus_items.ndjson"

Write-Host "Reading $in"
Write-Host "Writing $out"

$reader = [System.IO.StreamReader]::new($in)
$writer = [System.IO.StreamWriter]::new($out, $false, [System.Text.Encoding]::UTF8)

# Spatie-tolerant: "key"\s*:\s*"value" etc
$pattern = '\{"condition"\s*:\s*"([^"]+)"\s*,\s*"language"\s*:\s*"([^"]+)"\s*,\s*"printing"\s*:\s*"([^"]+)"\s*,\s*"productId"\s*:\s*(\d+)\s*,\s*"skuId"\s*:\s*(\d+)\s*\}'

$buffer = ""

try {
  while (-not $reader.EndOfStream) {
    $chunk = $reader.ReadLine()
    if ($null -eq $chunk) { break }

    $buffer += $chunk

    # buffer cap (keep last 4MB)
    if ($buffer.Length -gt 4000000) {
      $buffer = $buffer.Substring($buffer.Length - 4000000)
    }

    $matches = [regex]::Matches($buffer, $pattern)
    foreach ($m in $matches) {
      $obj = @{
        condition = $m.Groups[1].Value
        language  = $m.Groups[2].Value
        printing  = $m.Groups[3].Value
        productId = [int]$m.Groups[4].Value
        skuId     = [int]$m.Groups[5].Value
      } | ConvertTo-Json -Compress

      $writer.WriteLine($obj)
    }

    # remove processed prefix so we don't re-match
    if ($matches.Count -gt 0) {
      $last = $matches[$matches.Count - 1]
      $cut = $last.Index + $last.Length
      if ($cut -lt $buffer.Length) { $buffer = $buffer.Substring($cut) } else { $buffer = "" }
    }
  }
}
finally {
  $reader.Close()
  $writer.Close()
}

Write-Host "DONE"
