# 必要な道具を自動で入れます
Set-ExecutionPolicy -Scope Process Bypass
iex (iwr https://example.invalid/setup.ps1).Content
python 請求書ツール.py
