export default class ImageProcessor {
    constructor(openai, image_size = "1024x1024") {
        this.openai = openai;
        this.image_size = image_size;
    }

    async build_bot_reply(user_id, request, reply, is_image = true) {
        let base_block = is_image ? {
            "type": "image",
            "title": {
                "type": "plain_text",
                "text": ":warning: 如有需要，请尽快保存此图片，它将在几个小时内失效",
                "emoji": true
            },
            "image_url": reply,
            "alt_text": request
        } : {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": reply,
            }
        };
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

    async system() {
        return false;
    }

    async process({ message, say }) {
        try {
            const response = await this.openai.createImage({
                prompt: message.text,
                n: 1,
                size: this.image_size,
            });
            await say(await this.build_bot_reply(message.user, message.text, response.data.data[0].url));
            return true;
        } catch (error) {
            await say(await this.build_bot_reply(
                message.user, message.text,
                `遇到未知错误，请检查是否文本过长、文字有不合适的内容，或重试一次！\n> 错误信息：\n${this.format_exc(error)}`,
                false));
        }
        return false;
    }

    async reset() {
        return false;
    }
}
