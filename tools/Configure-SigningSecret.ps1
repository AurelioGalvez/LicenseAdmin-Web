param(
    [string]$Owner = "AurelioGalvez",
    [string]$Repository = "LicenseAdmin-Web",
    [string]$PrivateKeyPath = "$PSScriptRoot\..\.secrets\SIGNED_LICENSE_PRIVATE_KEY.pem"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PrivateKeyPath)) {
    throw "No se encontro la llave privada: $PrivateKeyPath"
}

Write-Host ""
Write-Host "La llave privada debe registrarse como el secret SIGNED_LICENSE_PRIVATE_KEY."
Write-Host "GitHub no permite crear Actions secrets con texto plano mediante REST."
Write-Host ""
Write-Host "Abre:"
Write-Host "https://github.com/$Owner/$Repository/settings/secrets/actions/new"
Write-Host ""
Write-Host "Nombre: SIGNED_LICENSE_PRIVATE_KEY"
Write-Host "Valor: el contenido completo de:"
Write-Host $PrivateKeyPath
Write-Host ""

Get-Content -Raw -LiteralPath $PrivateKeyPath | Set-Clipboard
Write-Host "La llave privada fue copiada al portapapeles."
