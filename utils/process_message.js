export default async function process_message(processor, obj, message) {
    await obj.client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: "memo",
    });
    const process_result = await processor.process(obj);
    await obj.client.reactions.remove({
        channel: message.channel,
        timestamp: message.ts,
        name: "memo",
    });
    await obj.client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: process_result ? "heavy_check_mark" : "x",
    });
}