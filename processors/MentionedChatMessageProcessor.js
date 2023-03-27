import FixedSizeQueue from "../utils/FixedSizeQueue.js";

export default class MentionedChatMessageProcessor {
    constructor(openai, slack_bot_id, system_prompt) {
        this.openai = openai;
        this.slack_bot_id = slack_bot_id;
    }

    format_exc(error) {
        return "> " + error.toString().replaceAll("\n", "\n> ");
    }

    async build_bot_reply(channel, user_id, request, thread_ts, reply) {
        return {
            "channel": channel,
            "thread_ts": thread_ts,
            "text": `<@${user_id}> ${reply}`,
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
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
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": "> _当前为被动回复模式，此模式下对话不存在上下文_",
                        }
                    ]
                },
            ]
        };
    }

    async remove_mention(text) {
        return text.replace(`<@${this.slack_bot_id}>`, "").trim();
    }

    async process({ event, say, client }) {
        const text = await this.remove_mention(event.text);
        try {
            const response = await this.openai.createChatCompletion({
                model: "gpt-3.5-turbo",
                messages: [{ "role": "user", "content": text }],
            });
            const response_message = response.data.choices[0].message;
            await client.chat.postMessage(await this.build_bot_reply(
                event.channel, event.user, text, event.thread_ts || event.ts,
                response_message.content.trim()));
            return true;
        } catch (error) {
            await client.chat.postMessage(await this.build_bot_reply(
                event.channel, event.user, text, event.thread_ts || event.ts,
                `遇到未知错误，请检查是否文本过长，或重试一次！\n> 错误信息：\n${this.format_exc(error)}`));
        }
        return false;
    }

    async system() {
        return false;
    }

    async reset() {
        return false;
    }
}
