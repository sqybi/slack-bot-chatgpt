
export default class FixedSizeQueue {
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