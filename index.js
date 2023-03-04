import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Configuration, OpenAIApi } from 'openai';
import bolt from '@slack/bolt';

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

// Data Structures
class FixedLengthQueue {
    constructor(max_size) {
        this.max_size = max_size;
        this.data = Array(max_size);
        this.begin = 0;
        this.size = 0;
    }

    static get_next_position(position) {
        return (position + 1) % this.max_size;
    }

    get_absolute_position(position) {
        return (this.begin + position) % this.max_size;
    }

    // Return value: `undefined` means nothing to pop.
    async pop() {
        if (this.size == 0) {
            return undefined;
        }
        const position_to_pop = this.begin;
        this.begin = this.get_next_position(this.begin);
        return this.data[position_to_pop];
    }

    // Return value: `true` means the beginning item is replaced.
    async push(item) {
        let replaced = false;
        if (this.size < this.max_size) {
            this.size++;
        } else {
            replaced = true;
            this.begin++;
        }
        this.data[this.get_absolute_position(this.size - 1)] = item;
        return replaced;
    }

    async clear() {
        this.size = 0;
    }

    list() {
        const result = Array();
        for (let i = 0; i < this.size; ++i) {
            result.push(this.data[this.get_absolute_position(i)]);
        }
        return result;
    }
}

class GeneralChatMessageProcessor {
    constructor() {
        this.history = new FixedLengthQueue(db.data.slack.general_chat_message.history_size);
    }

    format_exc(error) {
        return "> " + error.toString().replaceAll("\n", "\n> ");
    }

    async process(message) {
        const current_query = { "role": "user", "content": message.text };
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-3.5-turbo",
                messages: this.history.list().concat(current_query),
            });
            const response_message = response.data.choices[0].message;
            const response_query = { "role": response_message.role, "content": response_message.content };
            this.history.push(current_query);
            this.history.push(response_query);
            return `${response_message.content.trim()}`;
        } catch (error) {
            return `遇到未知错误，请检查是否文本过长，或重试一次！\n> 错误信息：\n${this.format_exc(error)}`;
        }
    }

    async build_bot_reply(user_id, request, reply) {
        return {
            "text": `<@${user_id}> ${reply}`,
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "plain_text",
                        "text": reply,
                    }
                },
                {
                    "type": "divider"
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `*<@${user_id}>*`
                        },
                        {
                            "type": "mrkdwn",
                            "text": request,
                        }
                    ]
                }
            ]
        };
    }

    async reset() {
        await this.history.clear();
        return true;
    }
}

class ImageProcessor {
    constructor() {
        this.image_size = db.data.slack.image.image_size;
    }

    async process(message) {
        try {
            const response = await openai.createImage({
                prompt: message.text,
                n: 1,
                size: this.image_size,
            });
            return response.data.data[0].url;
        } catch (error) {
            return `遇到未知错误，请检查是否文本过长、文字有不合适的内容，或重试一次！\n> 错误信息：\n${this.format_exc(error)}`;
        }
    }

    async build_bot_reply(user_id, request, reply) {
        let base_block = {
            "type": "section",
            "text": {
                "type": "plain_text",
                "text": reply,
            }
        }
        if (reply.startsWith("http")) {
            base_block = {
                "type": "image",
                "image_url": reply,
                "alt_text": request
            };
        }
        return {
            "text": `<@${user_id}> ${reply}`,
            "blocks": [
                base_block,
                {
                    "type": "divider"
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `*<@${user_id}>*`
                        },
                        {
                            "type": "mrkdwn",
                            "text": request,
                        }
                    ]
                }
            ]
        };
    }

    async reset() {
        return false;
    }
}

// Processors
const processors = {};
for (const channel of db.data.slack.general_chat_message.channels) {
    processors[channel] = new GeneralChatMessageProcessor();
}
for (const channel of db.data.slack.image.channels) {
    processors[channel] = new ImageProcessor();
}

// Slack app
const slack_app = new bolt.App({
    token: db.data.slack.bot_token,
    appToken: db.data.slack.app_token,
    socketMode: true,
});

slack_app.message(async ({ message, say, client }) => {
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
    const reply = await processor.process(message);
    if (reply) {
        await say(await processor.build_bot_reply(message.user, message.text, reply));
        await client.reactions.remove({
            channel: message.channel,
            timestamp: message.ts,
            name: "memo",
        });
        await client.reactions.add({
            channel: message.channel,
            timestamp: message.ts,
            name: "heavy_check_mark",
        });
    }
});

slack_app.command("/reset", async ({ command, ack, say }) => {
    await ack();
    if (!(command.channel_id in processors)) {
        return;
    }
    const processor = processors[command.channel_id];
    if (await processor.reset()) {
        await say({
            "text": `我已经忘记了我们之前的对话。现在可以重新开始向我提问了。\n> <@${command.user_id}> 已经重置会话历史`,
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "plain_text",
                        "text": "我已经忘记了我们之前的对话。现在可以重新开始向我提问了。",
                    }
                },
                {
                    "type": "divider"
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `<@${command.user_id}> 已经重置会话历史`,
                        }
                    ]
                }
            ]
        });
    }
});

// Main
(async () => {
    await slack_app.start();
    console.log('⚡️ Bolt app started');
})();
