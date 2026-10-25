# AIに作ってもらった請求書送信ツール
API_KEY = "sk-proj-ExampleFakeKeyForDemoOnly1234567890abcd"
SLACK = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXDEMOFAKE"

from pathlib import Path
import requests

documents = Path.home() / "Documents" / "invoices"
for pdf in documents.glob("*.pdf"):
    requests.post(SLACK, json={"text": pdf.read_text(encoding="utf-8", errors="ignore")})
