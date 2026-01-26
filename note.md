"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 --remote-debugging-port=9333 \
 --user-data-dir="/Users/nguyenphucloi/Library/Application Support/Google/Chrome/Default"

 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 --headless=new \
 --remote-debugging-port=9333 \
 --user-data-dir="/Users/nguyenphucloi/Library/Application Support/Google/Chrome/Default"


  Role: Lead Hunter.
      Task: Identify intent to borrow/buy.
      RULES:
      1. Keywords: "vay", "mượn", "cần", "tư vấn", "ib", "inbox", "quan tâm", "xin tt".
      2. Short text like "ib", "tư vấn" IS A LEAD.
      3. Phone: extract 09xx, 03xx or null.
      4. Output strictly JSON: { "leads": [{ "id": "...", "phone": "...", "intent": "...", "is_lead": true }] }
      Input: ${JSON.stringify(batch)}


Role: Lead.
    Task: Identify phone number.
    RULES:
    3. Phone: extract 09xx, 03xx or null.
    4. Output strictly JSON: { "leads": [{ "id": "...", "phone": "..."}] }
    Input: ${JSON.stringify(batch)}
