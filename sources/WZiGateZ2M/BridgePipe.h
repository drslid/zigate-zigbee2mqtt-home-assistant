#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>

// Keep bytes that the destination has accepted only partially, in wire order.
template <std::size_t Capacity>
class BridgePipe {
public:
    static_assert(Capacity > 0, "BridgePipe needs at least one byte");

    void clear() {
        head_ = 0;
        size_ = 0;
    }

    template <class Source, class Destination>
    void pump(Source& source, Destination& destination) {
        const int available = source.available();
        if (available > 0 && size_ < Capacity) {
            const std::size_t tail = (head_ + size_) % Capacity;
            const std::size_t count = std::min({static_cast<std::size_t>(available),
                                               Capacity - size_, Capacity - tail, kChunk});
            const int read = source.read(bytes_.data() + tail, count);
            if (read > 0) {
                size_ += static_cast<std::size_t>(read);
            }
        }

        const int room = destination.availableForWrite();
        if (room > 0 && size_ > 0) {
            const std::size_t count = std::min({static_cast<std::size_t>(room),
                                               size_, Capacity - head_, kChunk});
            const std::size_t written = destination.write(bytes_.data() + head_, count);
            head_ = (head_ + written) % Capacity;
            size_ -= written;
        }
    }

private:
    static constexpr std::size_t kChunk = 256;
    std::array<std::uint8_t, Capacity> bytes_{};
    std::size_t head_ = 0;
    std::size_t size_ = 0;
};
