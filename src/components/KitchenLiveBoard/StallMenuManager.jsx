import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../../firebase";
import { CATEGORIES, MAX_IMAGE_SOURCE_BYTES, compressImageToDataUri, money } from "./helpers";
import { ImageIcon, PencilIcon, TrashIcon, StarIcon, FlameIcon } from "./icons";

// ─── MODULE 2: Stall Menu Manager (products CRUD, isolated to assignedStall) ──
export default function StallMenuManager({ t, assignedStall }) {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", price: "", category: CATEGORIES[0], image: "" });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", price: "", category: CATEGORIES[0], image: "" });
  const [isUploadingAdd, setIsUploadingAdd] = useState(false);
  const [isUploadingEdit, setIsUploadingEdit] = useState(false);

  const handleImageFile = async (e, target) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_SOURCE_BYTES) {
      alert("Please choose an image smaller than 8MB.");
      return;
    }
    const setUploading = target === "add" ? setIsUploadingAdd : setIsUploadingEdit;
    setUploading(true);
    try {
      const dataUri = await compressImageToDataUri(file);
      if (target === "add") setAddForm((f) => ({ ...f, image: dataUri }));
      else setEditForm((f) => ({ ...f, image: dataUri }));
    } catch (error) {
      console.error("[StallMenuManager] Image processing failed:", error);
      alert(error.message || "Could not process the image. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const productQuery = query(collection(db, "products"), where("shop", "==", assignedStall));
    const unsubscribe = onSnapshot(
      productQuery,
      (snapshot) => {
        const items = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setProducts(items);
        setLoadError("");
        setIsLoading(false);
      },
      (error) => {
        console.error("[StallMenuManager] Products listener failed:", error);
        setLoadError("Could not load the menu. Check Firestore rules for the products collection.");
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [assignedStall]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addForm.name.trim() || !Number(addForm.price)) return;
    try {
      await addDoc(collection(db, "products"), {
        name: addForm.name.trim(),
        price: Number(addForm.price),
        category: addForm.category,
        image: addForm.image.trim(),
        shop: assignedStall,
        available: true,
        isSpecial: false,
        specialDiscountPercent: 0,
        isMostSold: false,
        rating: 0,
        reviewCount: 0,
        createdAt: serverTimestamp(),
      });
      setAddForm({ name: "", price: "", category: CATEGORIES[0], image: "" });
      setShowAddForm(false);
    } catch (error) {
      console.error("[StallMenuManager] Failed to add item:", error);
      alert("Could not add the item. Please try again.");
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name || "",
      price: String(product.price || ""),
      category: product.category || CATEGORIES[0],
      image: product.image || product.imageUrl || product.photoUrl || "",
    });
  };

  const saveEdit = async (productId) => {
    if (!editForm.name.trim() || !Number(editForm.price)) return;
    try {
      await updateDoc(doc(db, "products", productId), {
        name: editForm.name.trim(),
        price: Number(editForm.price),
        category: editForm.category,
        image: editForm.image.trim(),
      });
      setEditingId(null);
    } catch (error) {
      console.error("[StallMenuManager] Failed to update item:", error);
      alert("Could not save changes. Please try again.");
    }
  };

  const toggleAvailability = async (product) => {
    try {
      await updateDoc(doc(db, "products", product.id), { available: !(product.available !== false) });
    } catch (error) {
      console.error("[StallMenuManager] Failed to toggle availability:", error);
    }
  };

  const toggleSpecial = async (product) => {
    try {
      await updateDoc(doc(db, "products", product.id), { isSpecial: !product.isSpecial });
    } catch (error) {
      console.error("[StallMenuManager] Failed to toggle special:", error);
    }
  };

  const updateDiscount = async (product, percent) => {
    const clamped = Math.max(0, Math.min(90, Number(percent) || 0));
    try {
      await updateDoc(doc(db, "products", product.id), { specialDiscountPercent: clamped });
    } catch (error) {
      console.error("[StallMenuManager] Failed to update discount:", error);
    }
  };

  const toggleMostSold = async (product) => {
    try {
      await updateDoc(doc(db, "products", product.id), { isMostSold: !product.isMostSold });
    } catch (error) {
      console.error("[StallMenuManager] Failed to toggle most-sold:", error);
    }
  };

  const handleDelete = async (productId) => {
    if (!window.confirm("Remove this item from the menu? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "products", productId));
    } catch (error) {
      console.error("[StallMenuManager] Failed to delete item:", error);
      alert("Could not delete the item.");
    }
  };

  return (
    <section className={`border p-5 ${t.panel}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className={`text-[10px] uppercase tracking-[0.3em] ${t.label}`}>
          Stall Menu Manager — {assignedStall}
        </p>
        <button
          onClick={() => setShowAddForm((current) => !current)}
          className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition hover:bg-current/10 ${t.accentBorder} ${t.accent}`}
        >
          {showAddForm ? "Cancel" : "+ Add Item"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className={`mb-5 grid grid-cols-1 gap-3 border p-4 sm:grid-cols-4 ${t.panelAlt}`}>
          <input
            required
            placeholder="Item name"
            value={addForm.name}
            onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
            className={`border px-3 py-2 text-sm outline-none focus:border-current sm:col-span-2 ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
          />
          <input
            required
            type="number"
            min="1"
            placeholder="Price (INR)"
            value={addForm.price}
            onChange={(e) => setAddForm((f) => ({ ...f, price: e.target.value }))}
            className={`border px-3 py-2 text-sm outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
          />
          <select
            value={addForm.category}
            onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
            className={`border px-3 py-2 text-sm outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className={`flex items-center gap-2 border px-3 py-2 sm:col-span-4 ${t.inputBg} ${t.inputBorder}`}>
            {addForm.image ? (
              <img src={addForm.image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
            ) : (
              <ImageIcon />
            )}
            <label
              className={`shrink-0 cursor-pointer border px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition hover:bg-current/10 ${t.accentBorder} ${t.accent}`}
            >
              {isUploadingAdd ? "Processing..." : "Upload Photo"}
              <input type="file" accept="image/*" disabled={isUploadingAdd} onChange={(e) => handleImageFile(e, "add")} className="hidden" />
            </label>
            <input
              type="url"
              placeholder="...or paste an image URL"
              value={addForm.image}
              onChange={(e) => setAddForm((f) => ({ ...f, image: e.target.value }))}
              className={`w-full bg-transparent text-sm outline-none ${t.inputText}`}
            />
          </div>
          <button
            type="submit"
            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition sm:col-span-4 ${t.accentBg} ${t.accentText} ${t.accentBgHover}`}
          >
            Save New Item
          </button>
        </form>
      )}

      {loadError && <p className="mb-4 text-xs text-red-400">{loadError}</p>}

      {isLoading ? (
        <p className={`py-10 text-center text-[10px] uppercase tracking-widest ${t.label}`}>Loading menu...</p>
      ) : products.length === 0 ? (
        <p className={`py-10 text-center text-[10px] uppercase tracking-widest ${t.label}`}>No items yet — add your first one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead>
              <tr className={`border-b text-[9px] uppercase tracking-widest ${t.headerBorder} ${t.label}`}>
                <th className="py-2 pr-3">Image</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Price</th>
                <th className="py-2 pr-3">Special</th>
                <th className="py-2 pr-3">Discount %</th>
                <th className="py-2 pr-3">Most Sold</th>
                <th className="py-2 pr-3">Customer Rating</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const isEditing = editingId === product.id;
                const inStock = product.available !== false;
                const imageSrc = product.image || product.imageUrl || product.photoUrl || "";
                return (
                  <tr key={product.id} className={`border-b ${t.divider}`}>
                    <td className="py-3 pr-3">
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          {editForm.image && (
                            <img src={editForm.image} alt="" className="h-8 w-8 rounded object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                          )}
                          <label
                            className={`cursor-pointer border px-2 py-1 text-center text-[9px] font-bold uppercase tracking-widest transition hover:bg-current/10 ${t.accentBorder} ${t.accent}`}
                          >
                            {isUploadingEdit ? "Processing..." : "Upload"}
                            <input type="file" accept="image/*" disabled={isUploadingEdit} onChange={(e) => handleImageFile(e, "edit")} className="hidden" />
                          </label>
                          <input
                            type="url"
                            placeholder="...or paste a URL"
                            value={editForm.image}
                            onChange={(e) => setEditForm((f) => ({ ...f, image: e.target.value }))}
                            className={`w-32 border px-2 py-1 outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
                          />
                        </div>
                      ) : imageSrc ? (
                        <img src={imageSrc} alt={product.name} className="h-10 w-10 rounded object-cover" onError={(e) => (e.currentTarget.style.opacity = "0.15")} />
                      ) : (
                        <div className={`grid h-10 w-10 place-items-center rounded border ${t.accentBorder} ${t.label}`}>
                          <ImageIcon />
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      {isEditing ? (
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className={`w-full border px-2 py-1 outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
                        />
                      ) : (
                        <span className={`font-bold ${t.heading}`}>{product.name}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      {isEditing ? (
                        <select
                          value={editForm.category}
                          onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                          className={`border px-2 py-1 outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={t.body}>{product.category || "—"}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="1"
                          value={editForm.price}
                          onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                          className={`w-20 border px-2 py-1 outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
                        />
                      ) : (
                        <span className={t.heading}>{money(product.price)}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <button
                        onClick={() => toggleSpecial(product)}
                        title="Special of the Day"
                        className={`transition ${product.isSpecial ? "text-amber-500" : `${t.label} ${t.labelHover}`}`}
                      >
                        <StarIcon filled={product.isSpecial} />
                      </button>
                    </td>
                    <td className="py-3 pr-3">
                      <input
                        type="number"
                        min="0"
                        max="90"
                        disabled={!product.isSpecial}
                        value={product.specialDiscountPercent || 0}
                        onChange={(e) => updateDiscount(product, e.target.value)}
                        className={`w-16 border px-2 py-1 outline-none focus:border-current disabled:opacity-30 ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <button
                        onClick={() => toggleMostSold(product)}
                        title="Most Sold"
                        className={`transition ${product.isMostSold ? "text-orange-500" : `${t.label} ${t.labelHover}`}`}
                      >
                        <FlameIcon filled={product.isMostSold} />
                      </button>
                    </td>
                    <td className="py-3 pr-3">
                      {/* Read-only — customers submit these from the menu now, staff no longer set them manually. */}
                      {product.reviewCount > 0 ? (
                        <span className={t.body}>★ {(product.rating || 0).toFixed(1)} ({product.reviewCount})</span>
                      ) : (
                        <span className={t.label}>No reviews yet</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <button
                        onClick={() => toggleAvailability(product)}
                        className={`border px-3 py-1 text-[9px] font-bold uppercase tracking-widest transition ${
                          inStock
                            ? `${t.accentBorder} ${t.accent} hover:bg-current/10`
                            : "border-red-500/40 text-red-500 hover:bg-red-500/10"
                        }`}
                      >
                        {inStock ? "In Stock" : "Out of Stock"}
                      </button>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex justify-end gap-2">
                        {isEditing ? (
                          <button
                            onClick={() => saveEdit(product.id)}
                            disabled={isUploadingEdit}
                            className={`border px-3 py-1 text-[9px] font-bold uppercase tracking-widest hover:bg-current/10 disabled:opacity-50 ${t.accentBorder} ${t.accent}`}
                          >
                            Save
                          </button>
                        ) : (
                          <button onClick={() => startEdit(product)} className={`p-1.5 ${t.body} ${t.accentHoverText}`}>
                            <PencilIcon />
                          </button>
                        )}
                        <button onClick={() => handleDelete(product.id)} className="p-1.5 text-red-500/60 hover:text-red-500">
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
