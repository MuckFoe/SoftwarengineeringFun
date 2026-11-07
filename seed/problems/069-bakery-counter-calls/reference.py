def bakery_counter_calls(events: list[str]) -> list[str]:
    line = []
    head = 0
    served = []
    for ev in events:
        if ev == "call":
            if head < len(line):
                served.append(line[head])
                head += 1
            else:
                served.append("nobody")
        else:
            line.append(ev[len("join:"):])
    return served
