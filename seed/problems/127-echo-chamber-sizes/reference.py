def echo_chamber_sizes(n, follows):
    adj = [[] for _ in range(n)]
    for a, b in follows:
        adj[a].append(b)
    index = [-1] * n
    low = [0] * n
    on = [False] * n
    comp = []
    st = []
    counter = 0
    sizes = []
    for root in range(n):
        if index[root] != -1:
            continue
        index[root] = low[root] = counter
        counter += 1
        st.append(root)
        on[root] = True
        work = [(root, 0)]
        while work:
            v, i = work.pop()
            if i < len(adj[v]):
                work.append((v, i + 1))
                w = adj[v][i]
                if index[w] == -1:
                    index[w] = low[w] = counter
                    counter += 1
                    st.append(w)
                    on[w] = True
                    work.append((w, 0))
                elif on[w] and index[w] < low[v]:
                    low[v] = index[w]
            else:
                if low[v] == index[v]:
                    size = 0
                    while True:
                        w = st.pop()
                        on[w] = False
                        size += 1
                        if w == v:
                            break
                    sizes.append(size)
                if work:
                    p = work[-1][0]
                    if low[v] < low[p]:
                        low[p] = low[v]
    sizes.sort(reverse=True)
    return sizes
