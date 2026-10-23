# WordRush — mini live Kahoot for vocabulary classes

A working realtime **multiplayer** English vocabulary quiz (Node.js + Socket.IO) — *not* an offline simulation.

**Students:** open the shared website → enter the six-digit PIN → type their nickname → wait in the lobby → answer live questions on their own phones. After the final round, see the **top-three podium**, and when the teacher presses Next, the **full class ranking**.

**Teacher:** open `/teacher` → enter the teacher password → choose a quiz pack → create live game → share PIN → press Start → press Next to reveal/advance questions, show the podium, then show the full leaderboard. There is deliberately **no quiz-authoring dashboard**.

## Running it in Replit

1. Upload the files from this project into a Node.js Replit project (or import the ZIP).
2. In **Secrets**, add `TEACHER_PASSWORD` with a long private password. Do not put this password in code or give it to students.
3. Run `npm install`, then `npm start`. Replit can install dependencies automatically when you run the project.
4. Open the public web preview: `/teacher` is your control page, `/` is the student join page.
5. **Deploy with an always-on web deployment** to get a stable, public HTTPS URL that students can use on their phones. A local preview on your computer alone won't work on their phones. Follow the deployment flow in your current Replit account; paid hosting may be required.
6. If deployment uses multiple instances, configure **one server instance**, since rooms are currently stored in memory (not a shared database).

### Run on your own computer

Requires Node.js 20+. Run `npm install`, then on macOS/Linux `TEACHER_PASSWORD='choose-a-secret' npm start`; on Windows PowerShell `$env:TEACHER_PASSWORD='choose-a-secret'; npm start`. Visit `http://localhost:3000/teacher` and `http://localhost:3000`. For mobile devices, use a public deployment, or access the computer over its local network IP if your firewall allows it.

If you do not set `TEACHER_PASSWORD`, a random temporary teacher password is printed in the **server logs on each launch**. For deployment always set a secret.

## Add future vocabulary quizzes — no teacher quiz builder

Each vocabulary game is **one JSON file** in `quizzes/`. Request a quiz from ChatGPT and have it generate a new JSON file following the existing example; put that file in this folder and redeploy/restart. Once your Replit project is available to ChatGPT via compatible connected editing tools, quiz files may be added directly through that integration; this cannot be assumed without tool access.

Quiz file structure:

```json
{
  "id": "beginner-9a",
  "title": "English File Beginner — 9A",
  "subtitle": "Vocabulary review",
  "duration": 20,
  "questions": [
    {
      "prompt": "What does 'take photos' mean?",
      "options": ["Фотографировать", "Рисовать", "Писать", "Читать"],
      "correct": 0
    }
  ]
}
```

* `duration` is 5–120 seconds per question. The correct answer uses a zero-based index `0` to `3`.
* All students see the **same question/choice order** in a room. You can include up to 100 questions per quiz. The game auto-reveals when the timer expires or all currently registered students have answered; pressing Next while a question is live reveals immediately.
* Scoring: **0** for an incorrect answer; **500 to 1,000 points** for a correct answer depending on how quickly they respond. On a tie in points, most correct answers wins, then earlier join time.
* A player may answer **once** per question. The server, not the student's phone, calculates points and deadlines.

## Important limitations

* The MVP stores active games and scores in **server memory**. Restarting the app or redeploying during class **ends live rooms and erases current scores**. New classes create new PINs. A database would be a future improvement.
* The host and players can **reconnect or refresh** during a session, as long as the server hasn't restarted and the browser keeps its local storage.
* Maximum **80 students per room**, intended for ordinary classroom sizes, not a production-scale service.
* Names are displayed on classmates' phones and should be first names or pseudonyms only. No email or password for students.
* No student self-serve quiz building or teacher question editor (by design).
* Not yet hosted by ChatGPT; deployment is separate from the provided source code.

## Testing

Run `npm test` after `npm install`. Tests cover quiz validity, room creation, joining, answers, scoring, and podium/ranking sequence.
