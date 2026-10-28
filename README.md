# TAY'S STUDIO — Telegram Launch Bot

A separate Node.js service for a public Telegram channel. It creates a dark AMOLED-style launch graphic, pins the post when possible, and updates the countdown caption every minute. The progress percentage is configured with an environment variable.

## Important
- This is separate from the existing TAY'S STUDIO payment/subscription backend. Deploy it as a **new Railway service**.
- Never commit the Telegram bot token or put it in the Android APK.
- The configured launch time is an example: `2026-10-31T20:00:00-06:00` (Costa Rica, UTC-6). Confirm the exact time before announcing it.
- `LAUNCH_PROGRESS=85` is an initial estimate. Only publish it if 85% accurately reflects your release checklist.
- Keep `LAUNCH_MESSAGE_ID` set after the first run. Without it, a fresh process creates a new post.

## 1. Create the bot
1. Open https://t.me/BotFather and send `/newbot`.
2. Copy the token into Railway's `TELEGRAM_BOT_TOKEN` variable.
3. Add the bot as an administrator to the public channel, with permission to post and edit messages. Pinning permission is needed for automatic pinning.

## 2. Deploy as a separate Railway service
1. Put these files in a new GitHub repository, e.g. `tays-studio-telegram-launch`. Do not reuse or modify the existing payments repository.
2. In Railway, create a new project/service from this repository.
3. Set the start command to `npm start` (usually detected automatically).
4. Add these variables:
   - `TELEGRAM_BOT_TOKEN` = token from BotFather
   - `TELEGRAM_CHANNEL` = `@YourPublicChannel`
   - `LAUNCH_AT` = `2026-10-31T20:00:00-06:00` (change if needed)
   - `LAUNCH_PROGRESS` = `85`
   - `LAUNCH_MESSAGE_ID` = leave unset for the first run
5. Deploy and check the service logs. The bot prints the ID of the post it created.
6. Copy that numeric ID into `LAUNCH_MESSAGE_ID` in Railway and redeploy/restart. This prevents duplicate posts after service restarts.

## 3. How updates work
- Countdown caption: updated every 60 seconds.
- AMOLED progress artwork: regenerated from `LAUNCH_PROGRESS` and refreshed along with the caption each minute.
- Progress changes: edit `LAUNCH_PROGRESS` in Railway and restart/redeploy the service.
- When launch time passes, the countdown switches to a launch-day message. Stop the service or change the date after launch.

## 4. Test safely before launch
Use a private test channel first. Confirm the image is readable on mobile, the bot can edit the post, and pinning works. Then change `TELEGRAM_CHANNEL` to the public channel and deploy.

## 5. Troubleshooting
- `chat not found`: verify the channel username and that the bot is a channel administrator.
- `not enough rights`: grant permission to post/edit and pin.
- `message to edit not found`: check `LAUNCH_MESSAGE_ID` and ensure the post still exists.
- `message is not modified`: Telegram can return this if the generated caption/media is identical; if it occurs repeatedly, check the configured progress and current caption.
- Token exposed: revoke it in BotFather and replace the Railway variable immediately.
