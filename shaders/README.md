# shaders

Copper's ILP Metal shaders compile to `copper.metallib` here (via `build.sh`). The
three kernels — `unify_batch`, `coverage`, `constraint_mask` — arrive in phase 4
(#014). Until then this directory is empty and `build.sh` skips the shader step.
