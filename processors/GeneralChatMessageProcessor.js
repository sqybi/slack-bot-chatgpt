import FixedSizeQueue from "../utils/FixedSizeQueue.js";

export default class GeneralChatMessageProcessor {
    constructor(openai, history_size, system_prompt) {
        this.openai = openai;
        this.history_size = history_size;
        this.history = new FixedSizeQueue(history_size);
        this.default_system_prompt = system_prompt;
        this.system_queries = [{ "role": "system", "content": system_prompt }];
    }

    format_exc(error) {
        return "> " + error.toString().replaceAll("\n", "\n> ");
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

    async process({ message, say }) {
        const current_query = { "role": "user", "content": message.text };
        try {
            const response = await this.openai.createChatCompletion({
                model: "gpt-3.5-turbo",
                messages: this.system_queries.concat(this.history.list(), current_query),
            });
            const response_message = response.data.choices[0].message;
            const response_query = { "role": response_message.role, "content": response_message.content };
            this.history.push(current_query);
            this.history.push(response_query);
            await say(await this.build_bot_reply(message.user, message.text, response_message.content.trim()));
            return true;
        } catch (error) {
            await say(await this.build_bot_reply(
                message.user, message.text,
                `遇到未知错误，请检查是否文本过长，或重试一次！\n> 错误信息：\n${this.format_exc(error)}`));
        }
        return false;
    }

    async system({ command, say }, reset) {
        const text = command.text;
        const reply = {
            "text": "", //
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "plain_text",
                        "text": "",
                    }
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": "",
                        }
                    ]
                }
            ]
        };
        if (reset) {
            this.system_queries = [{ "role": "system", "content": this.default_system_prompt }];
            reply.text = `我已经重置了系统提示，现在的系统提示为：\`${this.default_system_prompt}\`\n> <@${command.user_id}> 请求重置系统提示`;
            reply.blocks[0].text.text = `我已经重置了系统提示，现在的系统提示为：\`${this.default_system_prompt}\``;
            reply.blocks[1].elements[0].text = `_<@${command.user_id}> 请求重置系统提示_`;
        } else {
            const system_prompt = text.trim();
            this.system_queries = [{ "role": "system", "content": system_prompt }];
            reply.text = `我已经设置了系统提示，现在的系统提示为：\`${system_prompt}\`\n> <@${command.user_id}> 请求设置系统提示`;
            reply.blocks[0].text.text = `我已经设置了系统提示，现在的系统提示为：\`${system_prompt}\``;
            reply.blocks[1].elements[0].text = `_<@${command.user_id}> 请求设置系统提示_`;
        }
        await(say(reply));
        return true;
    }

    async reset({ command, say }) {
        await this.history.clear();
        await say({
            "text": `我已经忘记了我们之前的对话。现在可以重新开始向我提问了。\n> <@${command.user_id}> 请求重置会话历史`,
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "plain_text",
                        "text": "我已经忘记了我们之前的对话。现在可以重新开始向我提问了。",
                    }
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `_<@${command.user_id}> 请求重置会话历史_`,
                        }
                    ]
                }
            ]
        });
        return true;
    }
}
