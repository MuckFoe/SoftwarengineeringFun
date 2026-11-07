def count_hamlet_clusters(n, footpaths):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    clusters = n
    for a, b in footpaths:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            clusters -= 1
    return clusters
