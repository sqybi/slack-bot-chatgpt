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

// Slack app
const slack_app = new bolt.App({
    token: db.data.slack.bot_token,
    appToken: db.data.slack.app_token,
    socketMode: true,
});

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

    static instance = new GeneralChatMessageProcessor();
    static get Instance() { return this.instance; }

    format_exc(error) {
        return "> " + error.toString().replaceAll("\n", "\n> ");
    }

    async process(message) {
        if (message.subtype) {
            return null;
        }
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
            return `<@${message.user}>\n${response_message.content.trim()}`;
        } catch (error) {
            return `<@${message.user}>\n遇到未知错误，请检查是否文本过长，或重试一次！\n> 错误信息：\n${this.format_exc(error)}`;
        }
    }

    async reset() {
        await this.history.clear();
    }
}

class ImageProcessor {
    constructor() { }

    static instance = new ImageProcessor();
    static get Instance() { return this.instance; }

    async process(message) {
        return "功能尚未开发完成！";
    }

    async reset() {}
}

const processors = {
    "C04SA96CTSQ": GeneralChatMessageProcessor.Instance, // #sqybi-gpt
    "C04SF5R7JF6": ImageProcessor.Instance, // #sqybi-gpt-image
};

slack_app.message(async ({ message, say }) => {
    if (!(message.channel in processors)) {
        return;
    }
    const processor = processors[message.channel];
    const reply = await processor.process(message);
    if (reply) {
        await say(reply);
    }
});

slack_app.command("/reset", async ({ command, ack, say }) => {
    await ack();
    if (!(command.channel_id in processors)) {
        return;
    }
    const processor = processors[command.channel_id];
    await processor.reset();
    await say(`用户 <@${command.user_id}> 已经重置会话记录，从现在开始，我已经忘记了之前的对话。`);
});

// Main
(async () => {
    await slack_app.start();
    console.log('⚡️ Bolt app started');
})();
