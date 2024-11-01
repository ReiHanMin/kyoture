<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EventLink extends Model
{
    protected $fillable = [
        'event_id',
        'url',
        'link_type'
    ];

    /**
     * Define the relationship with Event model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function event()
    {
        return $this->belongsTo(Event::class);
    }
}
