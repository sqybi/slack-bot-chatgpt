import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Configuration, OpenAIApi } from 'openai';
import bolt from '@slack/bolt';

import GeneralChatMessageProcessor from './processors/GeneralChatMessageProcessor.js';
import ImageProcessor from './processors/ImageProcessor.js';

// LowDB database
// Usage:
//   db.data.xxx = xxx;
//   await db.write();
const db = new Low(new JSONFile(join(dirname(fileURLToPath(import.meta.url)), "database.json")));
await db.read();

// OpenAI initialization
const openai = new OpenAIApi(new Configuration({
    apiKey: db.data.openai.secret_key,
}));

// Processors
const processors = {};
for (const channel of db.data.slack.general_chat_message.channels) {
    processors[channel] = new GeneralChatMessageProcessor(openai, db.data.slack.general_chat_message.history_size);
}
for (const channel of db.data.slack.image.channels) {
    processors[channel] = new ImageProcessor(openai, db.data.slack.image.image_size);
}

// Slack app
const slack_app = new bolt.App({
    token: db.data.slack.bot_token,
    appToken: db.data.slack.app_token,
    socketMode: true,
});

// Slack app event handlers
slack_app.message(async (obj) => {
    const message = obj.message;
    const client = obj.client;
    if (!message.channel || !(message.channel in processors)) {
        return;
    }
    // Do not response non-user messages. Do not response when messages are in threads.
    if (message.subtype || message.thread_ts) {
        return null;
    }
    await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: "memo",
    });
    const processor = processors[message.channel];
    const process_result = await processor.process(obj);
    await client.reactions.remove({
        channel: message.channel,
        timestamp: message.ts,
        name: "memo",
    });
    await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: process_result ? "heavy_check_mark" : "x",
    });
});

slack_app.command("/reset", async (obj) => {
    const command = obj.command;
    const ack = obj.ack;
    await ack();
    if (!(command.channel_id in processors)) {
        return;
    }
    const processor = processors[command.channel_id];
    await processor.reset(obj);
});

// Main
(async () => {
    await slack_app.start();
    console.log('⚡️ Bolt app started');
})();
